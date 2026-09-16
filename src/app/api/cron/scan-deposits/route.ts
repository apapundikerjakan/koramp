/**
 * GET /api/cron/scan-deposits
 * Background deposit scanner (P12).
 *
 * Called by Vercel Cron / external scheduler, NOT by browsers.
 * Scans oldest AWAITING_CRYPTO / CRYPTO_DETECTED sell orders (capped batch)
 * and updates them. Browsers only read DB status via poll-deposit (throttled).
 *
 * Auth: requires CRON_SECRET bearer when configured (production).
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getBlockchainProvider, type NetworkId } from '@/lib/blockchain';
import { findIncomingTx, confirmationState, logScan } from '@/lib/blockchain/scan';
import { processSellPayout } from '@/lib/orders';
import { ok } from '@/lib/response';

export const dynamic = 'force-dynamic';

const BATCH_LIMIT = 20;

// Overlap guard (§24): jangan tumpuk eksekusi dalam satu proses.
// (Keterbatasan: antar-instance serverless butuh lock terdistribusi —
//  operasi tetap idempotent sehingga overlap hanya buang RPC, tak merusak data.)
let running = false;

function sameAddr(a: string, b: string): boolean {
  if (a.startsWith('0x') && b.startsWith('0x')) return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) {
    const auth = req.headers.get('authorization') ?? '';
    if (auth !== `Bearer ${secret}`) {
      return ok({ ok: false, error: 'unauthorized' });
    }
  }

  // Overlap guard (§24): satu proses satu eksekusi.
  if (running) {
    // eslint-disable-next-line no-console
    console.info(JSON.stringify({ scope: 'cron', event: 'scan_skipped_overlap' }));
    return ok({ ok: false, error: 'overlapping' });
  }
  running = true;
  try {
    return await runScan();
  } finally {
    running = false;
  }
}

async function runScan() {
  const orders = await prisma.sellOrder.findMany({
    where: { status: { in: ['AWAITING_CRYPTO', 'CRYPTO_DETECTED', 'CONFIRMING'] } },
    orderBy: { createdAt: 'asc' },
    take: BATCH_LIMIT,
  });

  const t0 = Date.now();
  // eslint-disable-next-line no-console
  console.info(JSON.stringify({ scope: 'cron', event: 'scan_started', pending: orders.length }));

  let scanned = 0;
  let detected = 0;
  let confirmed = 0;
  let failed = 0;

  for (const order of orders) {
    if (order.expiresAt && new Date() > order.expiresAt && order.status === 'AWAITING_CRYPTO') continue;
    scanned++;
    try {
      const bc = getBlockchainProvider(order.network as NetworkId);
      const requiredConfs =
        order.requiredConfirmations ?? (order.assetSymbol === 'SOL' ? 32 : order.assetSymbol === 'ETH' ? 12 : 15);

      let txInfo = null;
      if (order.cryptoTxHash) {
        // Prioritas 1 (§16): hash diketahui → lacak hash, JANGAN scan address.
        txInfo = await bc.getTransaction(order.cryptoTxHash);
        if (txInfo && !sameAddr(txInfo.from, order.walletAddress)) continue;
        // FAILED tidak diproses (§8).
        if (txInfo && (txInfo.txStatus === 'FAILED' || txInfo.receiptStatus === 0)) {
          logScan('cron_tx_failed', {
            orderId: order.id, publicId: order.publicId, network: order.network,
            asset: order.assetSymbol, txHash: txInfo.txHash, state: 'FAILED',
          });
          failed++;
          continue;
        }
      } else {
        // Window kecil untuk cron (jalan tiap 60 dtk): 60 blok ≈ 3 mnt BSC /
        // ~2 mnt Base — cukup menutup interval, scan tetap cepat per order.
        txInfo = await findIncomingTx({
          network: order.network as NetworkId,
          depositAddress: order.depositAddress,
          expectedAmount: order.cryptoAmount.toString(),
          asset: order.assetSymbol,
          expectedSender: order.walletAddress,
          maxBlocks: 60,
        });
      }
      if (!txInfo) continue;
      if (!sameAddr(txInfo.from, order.walletAddress)) continue;

      const reused = await prisma.sellOrder.findFirst({
        where: { cryptoTxHash: txInfo.txHash, id: { not: order.id } },
        select: { id: true },
      });
      if (reused) continue;

      const state = confirmationState(txInfo.confirmations, requiredConfs);
      if (state === 'CONFIRMED' && order.status !== 'CRYPTO_CONFIRMED') {
        await prisma.$transaction(async (tx) => {
          await tx.sellOrder.update({
            where: { id: order.id },
            data: { status: 'CRYPTO_CONFIRMED', cryptoTxHash: txInfo!.txHash, confirmations: txInfo!.confirmations },
          });
          await tx.cryptoDeposit.updateMany({
            where: { sellOrderId: order.id },
            data: {
              txHash: txInfo!.txHash,
              senderAddress: txInfo!.from,
              confirmations: txInfo!.confirmations,
              isConfirmed: true,
              detectedAt: new Date(),
              confirmedAt: new Date(),
            },
          });
        });
        confirmed++;
        logScan('cron_confirmed', {
          orderId: order.id, publicId: order.publicId, network: order.network,
          asset: order.assetSymbol, txHash: txInfo.txHash,
          confirmations: txInfo.confirmations, requiredConfirmations: requiredConfs, state,
        });
        try {
          await processSellPayout(order.id);
        } catch (e) {
          console.error('[cron/scan-deposits] payout error:', e);
        }
      } else if (state !== 'CONFIRMED' && (order.status === 'AWAITING_CRYPTO' || order.status === 'CRYPTO_DETECTED')) {
        const nextStatus = state === 'CONFIRMING' ? 'CONFIRMING' : 'CRYPTO_DETECTED';
        await prisma.sellOrder.update({
          where: { id: order.id },
          data: { status: nextStatus, cryptoTxHash: txInfo.txHash, confirmations: txInfo.confirmations },
        });
        detected++;
      } else if (order.status === 'CONFIRMING' || order.status === 'CRYPTO_DETECTED') {
        await prisma.sellOrder.update({
          where: { id: order.id },
          data: { cryptoTxHash: txInfo.txHash, confirmations: txInfo.confirmations },
        });
      }
    } catch (e) {
      console.error('[cron/scan-deposits] order error:', order.publicId, e);
    }
  }

  // eslint-disable-next-line no-console
  console.info(JSON.stringify({
    scope: 'cron', event: 'scan_completed',
    scanned, detected, confirmed, failed, durationMs: Date.now() - t0,
  }));

  return ok({ ok: true, scanned, detected, confirmed, failed });
}
