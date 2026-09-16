import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getBlockchainProvider, type NetworkId } from '@/lib/blockchain';
import { ok, handleError } from '@/lib/response';
import { NotFoundError, OrderStateError } from '@/lib/errors';
import { rateLimit, getClientIp } from '@/lib/rateLimit';
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
    if (!rateLimit('confirmed-sent', ip, 10, 60_000)) {
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

    const body = schema.parse(await req.json().catch(() => ({})));

    // Only store txHash after on-chain verification (sender must match order wallet).
    // FAILED txs are rejected outright (§8) — never stored.
    if (body.txHash) {
      const bc = getBlockchainProvider(order.network as NetworkId);
      const txInfo = await bc.getTransaction(body.txHash).catch(() => null);
      if (!txInfo) {
        throw new OrderStateError('txHash tidak ditemukan di blockchain — periksa hash Anda');
      }
      if (txInfo.txStatus === 'FAILED' || txInfo.receiptStatus === 0) {
        throw new OrderStateError('Transaksi GAGAL di blockchain — tidak bisa dipakai');
      }
      const same = body.txHash.startsWith('0x') || txInfo.from.startsWith('0x')
        ? txInfo.from.toLowerCase() === order.walletAddress.toLowerCase()
        : txInfo.from === order.walletAddress;
      if (!same) {
        throw new OrderStateError('txHash bukan dari wallet order ini');
      }
      await prisma.sellOrder.update({
        where: { publicId: params.publicId },
        data: { cryptoTxHash: body.txHash },
      });
    }

    await prisma.auditLog.create({
      data: {
        action: 'USER_CONFIRMED_SENT',
        entity: 'SellOrder',
        entityId: order.id,
        actor: order.walletAddress,
        metadata: JSON.stringify({ txHash: body.txHash ?? null }),
      },
    });

    return ok({ message: 'Dicatat. Kami akan verifikasi transaksi secara independen di blockchain.' });
  } catch (err) { return handleError(err); }
}

