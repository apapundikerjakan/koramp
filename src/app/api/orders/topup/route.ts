import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createTopUpOrder } from '@/lib/orders';
import { ok, handleError } from '@/lib/response';
import { rateLimit, getClientIp } from '@/lib/rateLimit';
import { assertWalletForOrder } from '@/lib/validateWallet';

export const dynamic = 'force-dynamic';

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

const schema = z.object({
  walletAddress: z.string().min(10).max(100),
  walletType: z.enum(['EVM', 'SOLANA']),
  quoteId: z.string().uuid(),
  asset: z.enum(['SOL', 'ETH', 'BNB']),
  network: z.enum(['SOLANA', 'BASE', 'BSC']),
});

export async function POST(req: NextRequest) {
  try {
    // Rate limiting
    const ip = getClientIp(req);
    // Ban gate: rejected before any expensive work (blockchain RPC, KiPay, DB writes).
    {
      const { banGate } = await import('@/lib/security');
      const rej = await banGate(ip);
      if (rej) return NextResponse.json(rej.body, { status: rej.status, headers: { 'Retry-After': String(rej.retryAfter) } });
    }
    if (!rateLimit('topup-order', ip, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)) {
      return NextResponse.json(
        { error: { code: 'RATE_LIMITED', message: 'Too many requests. Silakan coba lagi nanti.' } },
        { status: 429 }
      );
    }
    
    const { readJsonBounded } = await import('@/lib/apiGuard');
    const body = schema.parse(await readJsonBounded(req));

    // Backend validation: reject wallet/network/asset mismatch (400, not 500)
    assertWalletForOrder({ asset: body.asset, network: body.network, walletType: body.walletType, walletAddress: body.walletAddress });

    const result = await createTopUpOrder(body);
    const paymentCreation = 'paymentCreation' in result ? result.paymentCreation : undefined;
    return ok(
      { order: result.order, payment: result.payment, kipayTrxId: result.kipayTrxId, paymentCreation },
      paymentCreation ? 202 : 201,
    );
  } catch (err) { return handleError(err); }
}


