/**
 * POST /api/orders/:publicId/poll-deposit
 *
 * Lightweight status endpoint (P12). Heavy chain scans are throttled per-order
 * and primarily performed by background cron (/api/cron/scan-deposits).
 * Browser polling only reads DB status + throttled re-check.
 *
 * SECURITY (P10):
 *  - Matches network + asset + deposit address + expected amount (Decimal)
 *    + sender == order.walletAddress.
 *  - txHash cannot be reused across sell orders (DB uniqueness check).
 *  - Shared platform wallet limitation is documented; sender binding mitigates spoofing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getBlockchainProvider, type NetworkId } from '@/lib/blockchain';
import { findIncomingTx, confirmationState, logScan, sameAddress } from '@/lib/blockchain/scan';
import { processSellPayout } from '@/lib/orders';
import { ok, handleError } from '@/lib/response';
import { rateLimit, getClientIp } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

// Per-order scan throttle: avoid expensive RPC on every browser poll (P12).
const lastScanAt = new Map<string, number>();
const SCAN_THROTTLE_MS = 15_000;

export async function POST(
  req: NextRequest,
  { params }: { params: { publicId: string } },
) {
  try {
    const ip = getClientIp(req);
    // Ban gate: rejected before any expensive work (blockchain RPC, Xendit, DB writes).
    {
      const { banGate } = await import('@/lib/security');
      const rej = await banGate(ip);
      if (rej) return NextResponse.json(rej.body, { status: rej.status, headers: { 'Retry-After': String(rej.retryAfter) } });
    }
    if (!(await rateLimit(`poll-deposit:${params.publicId}`, ip, 6, 60_000))) {
      return ok({ polled: false, reason: 'rate_limited' });
    }

    const order = await prisma.sellOrder.findUnique({
      where: { publicId: params.publicId },
    });

    if (!order) return ok({ polled: false, reason: 'not_found' });

    // Only poll for orders that are still waiting. Expired orders never scan.
    if (order.expiresAt && new Date() > order.expiresAt && order.status === 'AWAITING_CRYPTO') {
      return ok({ polled: false, reason: 'expired', status: order.status });
    }
    if (!['AWAITING_CRYPTO', 'CRYPTO_DETECTED', 'CONFIRMING'].includes(order.status)) {
      return ok({
        polled: false,
        reason: 'not_waiting',
        status: order.status,
      });
    }

    // Check if already has a txHash stored (re-check confirmations)
    const txHashToCheck = order.cryptoTxHash ?? undefined;

    const bc = getBlockchainProvider(order.network as NetworkId);
    const requiredConfs = order.requiredConfirmations ??
      (order.assetSymbol === 'SOL' ? 32 : order.assetSymbol === 'ETH' ? 12 : 15);

    let txInfo = null;

    if (txHashToCheck) {
      // Already detected a tx before — just re-check confirmations.
      // Verify stored tx still belongs to this order's wallet (defense in depth).
      txInfo = await bc.getTransaction(txHashToCheck);
      if (txInfo && !sameAddress(txInfo.from, order.walletAddress)) {
        console.error(`[poll-deposit] stored tx sender mismatch for order ${order.publicId}: ${txInfo.from} != ${order.walletAddress}`);
        return ok({ polled: true, found: false, status: order.status, reason: 'sender_mismatch' });
      }
      // FAILED (§8): receipt gagal tidak boleh naik status — jangan payout.
      if (txInfo && (txInfo.txStatus === 'FAILED' || txInfo.receiptStatus === 0)) {
        logScan('poll_tx_failed', {
          orderId: order.id, publicId: order.publicId, network: order.network,
          asset: order.assetSymbol, txHash: txInfo.txHash, state: 'FAILED',
        });
        return ok({ polled: true, found: false, status: order.status, reason: 'tx_failed' });
      }
    } else {
      // Throttle fresh scans: browser polls often; chain scan at most every 15s per order.
      const now = Date.now();
      const last = lastScanAt.get(order.id) ?? 0;
      if (now - last < SCAN_THROTTLE_MS) {
        return ok({ polled: true, found: false, status: order.status, reason: 'throttled' });
      }
      lastScanAt.set(order.id, now);

      // Fresh scan with sender binding (P10) + Decimal amount (P23).
      txInfo = await findIncomingTx({
        network: order.network as NetworkId,
        depositAddress: order.depositAddress,
        expectedAmount: order.cryptoAmount.toString(),
        asset: order.assetSymbol,
        expectedSender: order.walletAddress,
      });
    }

    if (!txInfo) {
      return ok({ polled: true, found: false, status: order.status });
    }

    // Enforce sender binding even if scanner returned without filter (defense in depth).
    if (!sameAddress(txInfo.from, order.walletAddress)) {
      console.error(`[poll-deposit] rejecting tx from wrong wallet for order ${order.publicId}`);
      return ok({ polled: true, found: false, status: order.status, reason: 'sender_mismatch' });
    }

    // Enforce txHash uniqueness across sell orders (P10).
    const reused = await prisma.sellOrder.findFirst({
      where: { cryptoTxHash: txInfo.txHash, id: { not: order.id } },
      select: { id: true, publicId: true },
    });
    if (reused) {
      console.error(`[poll-deposit] txHash reuse blocked: ${txInfo.txHash} already used by ${reused.publicId}`);
      return ok({ polled: true, found: false, status: order.status, reason: 'tx_reused' });
    }

    // Found a transaction — update status based on confirmation count.
    // State nyata (§15): DETECTED (0) → CONFIRMING (1..req-1) → CONFIRMED.
    // Confirmations ditulis terus (progres counter UI), status tak pernah mundur.
    const state = confirmationState(txInfo.confirmations, requiredConfs);
    const baseLog = {
      orderId: order.id, publicId: order.publicId, network: order.network,
      asset: order.assetSymbol, txHash: txInfo.txHash, sender: txInfo.from,
      recipient: txInfo.to, expectedAmount: order.cryptoAmount.toString(),
      actualAmount: txInfo.amount, blockNumber: txInfo.blockNumber,
      confirmations: txInfo.confirmations, requiredConfirmations: requiredConfs,
      state,
    };

    if (state === 'CONFIRMED') {
      // Fully confirmed — mark CRYPTO_CONFIRMED and trigger payout (awaited, durable).
      if (order.status !== 'CRYPTO_CONFIRMED') {
        await prisma.$transaction(async (tx) => {
          await tx.sellOrder.update({
            where: { id: order.id },
            data: {
              status: 'CRYPTO_CONFIRMED',
              cryptoTxHash: txInfo!.txHash,
              confirmations: txInfo!.confirmations,
            },
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
          await tx.auditLog.create({
            data: {
              action: 'CRYPTO_AUTO_CONFIRMED',
              entity: 'SellOrder',
              entityId: order.id,
              actor: order.walletAddress,
              metadata: JSON.stringify({
                txHash: txInfo!.txHash,
                confirmations: txInfo!.confirmations,
                amount: txInfo!.amount,
                from: txInfo!.from,
              }),
            },
          });
        });

        try {
          await processSellPayout(order.id);
        } catch (err) {
          console.error('[poll-deposit] payout error (recoverable by cron):', err);
        }
      }
      logScan('poll_confirmed', baseLog);

      return ok({
        polled: true,
        found: true,
        confirmed: true,
        state,
        txHash: txInfo.txHash,
        confirmations: txInfo.confirmations,
        requiredConfirmations: requiredConfs,
        status: 'CRYPTO_CONFIRMED',
      });
    } else {
      // DETECTED / CONFIRMING — naikkan progres, simpan konfirmasi.
      const nextStatus = state === 'CONFIRMING' ? 'CONFIRMING' : 'CRYPTO_DETECTED';
      if (order.status === 'AWAITING_CRYPTO' || (order.status === 'CRYPTO_DETECTED' && nextStatus === 'CONFIRMING')) {
        await prisma.$transaction(async (tx) => {
          await tx.sellOrder.update({
            where: { id: order.id },
            data: {
              status: nextStatus,
              cryptoTxHash: txInfo!.txHash,
              confirmations: txInfo!.confirmations,
            },
          });
          await tx.cryptoDeposit.updateMany({
            where: { sellOrderId: order.id },
            data: {
              txHash: txInfo!.txHash,
              senderAddress: txInfo!.from,
              confirmations: txInfo!.confirmations,
              detectedAt: new Date(),
            },
          });
        });
      } else {
        // Already CONFIRMING/DETECTED — just update confirmations
        await prisma.sellOrder.update({
          where: { id: order.id },
          data: { cryptoTxHash: txInfo.txHash, confirmations: txInfo.confirmations },
        });
        await prisma.cryptoDeposit.updateMany({
          where: { sellOrderId: order.id },
          data: { confirmations: txInfo.confirmations },
        });
      }
      logScan('poll_progress', baseLog);

      return ok({
        polled: true,
        found: true,
        confirmed: false,
        state,
        txHash: txInfo.txHash,
        confirmations: txInfo.confirmations,
        requiredConfirmations: requiredConfs,
        status: nextStatus,
      });
    }
  } catch (err) {
    console.error('[poll-deposit] error:', err);
    return handleError(err);
  }
}

