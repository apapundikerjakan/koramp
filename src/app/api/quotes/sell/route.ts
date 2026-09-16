import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createQuote } from '@/lib/pricing';
import { ok, handleError } from '@/lib/response';
import { rateLimit, getClientIp } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;

// Accept EITHER cryptoAmount OR idrAmount (desired payout), not both
const schema = z.object({
  asset:        z.enum(['SOL', 'ETH', 'BNB']),
  network:      z.enum(['SOLANA', 'BASE', 'BSC']),
  cryptoAmount: z.string().min(1).optional(),
  idrAmount:    z.string().min(1).optional(),
}).refine(d => d.cryptoAmount || d.idrAmount, {
  message: 'Sertakan cryptoAmount (jumlah koin) atau idrAmount (payout IDR yang diinginkan)',
});

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    // Ban gate: rejected before any expensive work (blockchain RPC, KiPay, DB writes).
    {
      const { banGate } = await import('@/lib/security');
      const rej = await banGate(ip);
      if (rej) return NextResponse.json(rej.body, { status: rej.status, headers: { 'Retry-After': String(rej.retryAfter) } });
    }
    if (!rateLimit('quote-sell', ip, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)) {
      return NextResponse.json(
        { error: { code: 'RATE_LIMITED', message: 'Too many quote requests. Silakan coba lagi nanti.' } },
        { status: 429 },
      );
    }

    const body = schema.parse(await req.json());
    const quote = await createQuote(
      'SELL',
      body.asset,
      body.network,
      body.idrAmount,    // desired payout mode
      body.cryptoAmount, // crypto-amount mode
    );
    return ok({ quote });
  } catch (err) { return handleError(err); }
}


