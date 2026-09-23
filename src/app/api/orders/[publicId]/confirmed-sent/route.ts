import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getBlockchainProvider, type NetworkId } from '@/lib/blockchain';
import { sameAddress } from '@/lib/blockchain/scan';
import { ok, handleError } from '@/lib/response';
import { NotFoundError, OrderStateError } from '@/lib/errors';
import { rateLimit, getClientIp } from '@/lib/rateLimit';
import { audit } from '@/lib/audit';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const schema = z.object({
  txHash: z.string().min(10).max(200).optional(),
});

// User presses "I have sent" — informational only.
// Backend verifies blockchain independently. Never trust this to confirm payment.
// txHash is validated (format + on-chain sender match) before storing to prevent
// arbitrary DB writes / txHash spoofing.
export async function POST(req: NextRequest, { params }: { params: { publicId: string } }) {
  try {
    const ip = getClientIp(req);
    // Ban gate: rejected before any expensive work (blockchain RPC, KiPay, DB writes).
    {
      const { banGate } = await import('@/lib/security');
      const rej = await banGate(ip);
      if (rej) return NextResponse.json(rej.body, { status: rej.status, headers: { 'Retry-After': String(rej.retryAfter) } });
    }
    if (!(await rateLimit('confirmed-sent', ip, 10, 60_000))) {
      return NextResponse.json(
        { error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
        { status: 429 },
      );
    }

    const order = await prisma.sellOrder.findUnique({ where: { publicId: params.publicId } });
    if (!order) throw new NotFoundError('Order tidak ditemukan');
    if (order.status !== 'AWAITING_CRYPTO') {
      throw new OrderStateError(`Order berstatus ${order.status}, bukan AWAITING_CRYPTO`);
    }

    const { readJsonBounded } = await import('@/lib/apiGuard');
    const rawBody = await readJsonBounded(req).catch(() => ({}));
    // Strict txHash format: EVM 0x+64hex or Solana base58 32-44 chars.
    const strictSchema = z.object({
      txHash: z.string().regex(/^(0x[0-9a-fA-F]{64}|[1-9A-HJ-NP-Za-km-z]{32,44})$/).optional(),
    });
    const body = strictSchema.parse(rawBody);

    // Only store txHash after on-chain verification (sender must match order wallet).
    // FAILED txs are rejected outright (§8) — never stored.
    if (body.txHash) {
      const bc = getBlockchainProvider(order.network as NetworkId);
      const txInfo = await bc.getTransaction(body.txHash).catch(() => null);
      if (!txInfo) {
        throw new OrderStateError('txHash tidak ditemukan di blockchain. Periksa hash Anda');
      }
      if (txInfo.txStatus === 'FAILED' || txInfo.receiptStatus === 0) {
        throw new OrderStateError('Transaksi GAGAL di blockchain, tidak bisa dipakai');
      }
      if (!sameAddress(txInfo.from, order.walletAddress)) {
        throw new OrderStateError('txHash bukan dari wallet order ini');
      }
      // Store canonical on-chain hash (checksum-normalized), not raw user input.
      await prisma.sellOrder.update({
        where: { publicId: params.publicId },
        data: { cryptoTxHash: txInfo.txHash },
      });
    }

    await audit({
      action: 'USER_CONFIRMED_SENT',
      entity: 'SellOrder',
      entityId: order.id,
      actor: order.walletAddress,
      metadata: { txHash: body.txHash ?? null },
    });

    return ok({ message: 'Dicatat. Kami akan verifikasi transaksi secara independen di blockchain.' });
  } catch (err) { return handleError(err); }
}

