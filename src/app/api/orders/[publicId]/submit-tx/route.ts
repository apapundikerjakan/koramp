import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getBlockchainProvider, type NetworkId } from '@/lib/blockchain';
import {
  validateTxForOrder,
  confirmationState,
  logScan,
  type TxCheckReason,
} from '@/lib/blockchain/scan';
import { SUPPORTED_ASSETS } from '@/lib/assets';
import { ok, handleError } from '@/lib/response';
import { rateLimit, getClientIp } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/orders/:publicId/submit-tx
 *
 * Endpoint UTAMA pelacakan transaksi EVM (§4): frontend yang sudah memegang
 * txHash (dari wallet.sendTransaction) WAJIB submit ke sini — backend
 * melacak hash tersebut, BUKAN mencari ulang via block scan.
 *
 * Verifikasi (§21): order → network → asset → chainId → format hash →
 * tx ada/pending → receipt sukses → from → to → amount exact (wei) →
 * belum dipakai order lain.
 *
 * Manual paste tetap didukung sebagai recovery ("kirim dari wallet lain"),
 * tapi BUKAN alur normal — alur normal otomatis dari wallet aplikasi (§20).
 */

const schema = z.object({
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'Format TX hash tidak valid (0x + 64 hex)'),
});

const ALLOWED_STATUSES = ['AWAITING_CRYPTO', 'CRYPTO_DETECTED', 'CONFIRMING'];

export async function POST(
  req: NextRequest,
  { params }: { params: { publicId: string } },
) {
  const t0 = Date.now();
  try {
    const ip = getClientIp(req);
    {
      const { banGate } = await import('@/lib/security');
      const rej = await banGate(ip);
      if (rej) return NextResponse.json(rej.body, { status: rej.status, headers: { 'Retry-After': String(rej.retryAfter) } });
    }
    if (!rateLimit(`submit-tx:${params.publicId}`, ip, 6, 60_000)) {
      return NextResponse.json(
        { error: { code: 'RATE_LIMITED', message: 'Too many requests. Silakan coba lagi nanti.' } },
        { status: 429 }
      );
    }

    const order = await prisma.sellOrder.findUnique({
      where: { publicId: params.publicId },
    });
    if (!order) return ok({ stored: false, reason: 'not_found' });
    if (!ALLOWED_STATUSES.includes(order.status)) {
      return ok({ stored: false, reason: 'not_waiting', status: order.status });
    }
    if (order.network !== 'BASE' && order.network !== 'BSC') {
      return ok({ stored: false, reason: 'unsupported_network', message: 'Submit manual khusus jaringan EVM (Base/BSC).' });
    }

    const body = schema.parse(await req.json());
    const baseLog = {
      orderId: order.id,
      publicId: order.publicId,
      network: order.network,
      asset: order.assetSymbol,
      txHash: body.txHash,
    };

    // Asset ↔ network consistency (data order, bukan input client).
    const cfg = SUPPORTED_ASSETS[order.assetSymbol as keyof typeof SUPPORTED_ASSETS];
    if (!cfg || cfg.networkId !== order.network) {
      logScan('submit_rejected', { ...baseLog, state: 'asset_mismatch', durationMs: Date.now() - t0 });
      return ok({ stored: false, reason: 'asset_mismatch', message: 'Aset tidak cocok dengan jaringan order.' });
    }

    // Chain ID endpoint (§9) — fail closed sebelum inspeksi.
    const { verifyNetworkChain } = await import('@/lib/blockchain/evm');
    const chain = await verifyNetworkChain(order.network).catch(() => null);
    if (!chain || !chain.ok) {
      logScan('submit_rejected', {
        ...baseLog, state: 'wrong_network',
        error: `RPC chain ${chain?.actual} != ${chain?.expected}`,
        durationMs: Date.now() - t0,
      });
      return ok({ stored: false, reason: 'wrong_network', message: 'RPC tidak melayani jaringan order. Coba lagi nanti.' });
    }

    const bc = getBlockchainProvider(order.network as NetworkId);
    const txInfo = await bc.getTransaction(body.txHash);
    if (!txInfo) {
      logScan('submit_rejected', { ...baseLog, state: 'tx_not_found', durationMs: Date.now() - t0 });
      return ok({ stored: false, reason: 'tx_not_found', message: 'TX tidak ditemukan di blockchain. Periksa hash & jaringan.' });
    }

    // Satu pintu validasi (amount wei-exact, receipt sukses mutlak).
    const check = await validateTxForOrder(txInfo, {
      depositAddress: order.depositAddress,
      walletAddress: order.walletAddress,
      expectedAmountEth: order.cryptoAmount.toString(),
    });
    if (!check.ok) {
      const reason: TxCheckReason = check.reason;
      logScan('submit_rejected', {
        ...baseLog,
        state: reason,
        sender: txInfo.from,
        recipient: txInfo.to,
        expectedAmount: order.cryptoAmount.toString(),
        actualAmount: txInfo.amount,
        blockNumber: txInfo.blockNumber,
        durationMs: Date.now() - t0,
      });
      return ok({ stored: false, reason, message: check.message });
    }

    const reused = await prisma.sellOrder.findFirst({
      where: { cryptoTxHash: txInfo.txHash, id: { not: order.id } },
      select: { id: true, publicId: true },
    });
    if (reused) {
      logScan('submit_rejected', { ...baseLog, state: 'tx_reused', durationMs: Date.now() - t0 });
      return ok({ stored: false, reason: 'tx_reused', message: 'TX ini sudah dipakai order lain.' });
    }

    const required = order.requiredConfirmations;
    const state = txInfo.pending ? 'PENDING' : confirmationState(txInfo.confirmations, required);

    // Simpan sebagai tracking utama (§14): hash di order + deposit.
    // PENDING tidak dianggap gagal (§4) — cukup persist dan monitor.
    const bookingExtension =
      order.expiresAt && new Date() > order.expiresAt ? new Date(Date.now() + 60 * 60 * 1000) : undefined;
    await prisma.$transaction(async (tx) => {
      await tx.sellOrder.update({
        where: { id: order.id },
        data: {
          // CONFIRMED langsung bila sudah cukup; else naikkan progres
          // (AWAITING→DETECTED, DETECTED→CONFIRMING) tanpa pernah mundur.
          status: state === 'CONFIRMED' ? 'CRYPTO_CONFIRMED'
            : state === 'CONFIRMING' ? 'CONFIRMING'
            : 'CRYPTO_DETECTED',
          cryptoTxHash: txInfo.txHash,
          confirmations: txInfo.confirmations,
          ...(bookingExtension ? { expiresAt: bookingExtension } : {}),
        },
      });
      await tx.cryptoDeposit.updateMany({
        where: { sellOrderId: order.id },
        data: {
          txHash: txInfo.txHash,
          senderAddress: txInfo.from,
          confirmations: txInfo.confirmations,
          isConfirmed: state === 'CONFIRMED',
          detectedAt: new Date(),
          ...(state === 'CONFIRMED' ? { confirmedAt: new Date() } : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          action: 'CRYPTO_MANUAL_SUBMIT',
          entity: 'SellOrder',
          entityId: order.id,
          actor: order.walletAddress,
          metadata: JSON.stringify({
            txHash: txInfo.txHash,
            confirmations: txInfo.confirmations,
            state,
            expiryExtended: !!bookingExtension,
          }),
        },
      });
    });

    logScan('submit_accepted', {
      ...baseLog,
      sender: txInfo.from,
      recipient: txInfo.to,
      expectedAmount: order.cryptoAmount.toString(),
      actualAmount: txInfo.amount,
      blockNumber: txInfo.blockNumber,
      confirmations: txInfo.confirmations,
      requiredConfirmations: required,
      state,
      durationMs: Date.now() - t0,
    });

    // CONFIRMED langsung → picu payout via jalur standar (cron reconcile
    // memulihkan bila proses mati di tengah — P14).
    if (state === 'CONFIRMED') {
      try {
        const { processSellPayout } = await import('@/lib/orders');
        await processSellPayout(order.id);
      } catch (err) {
        console.error('[submit-tx] payout error (recoverable by cron):', err);
      }
    }

    return ok({
      stored: true,
      state,
      txHash: txInfo.txHash,
      confirmations: txInfo.confirmations,
      requiredConfirmations: required,
    });
  } catch (err) {
    return handleError(err);
  }
}
