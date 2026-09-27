import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createQuote } from '@/lib/pricing';
import { ok, handleError } from '@/lib/response';
import { rateLimit, getClientIp } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;

const schema = z.object({
  asset: z.enum(['SOL', 'ETH', 'BNB']),
  network: z.enum(['SOLANA', 'BASE', 'BSC']),
  idrAmount: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    // Rate limiting untuk quote request
    const ip = getClientIp(req);
    // Ban gate: rejected before any expensive work (blockchain RPC, Xendit, DB writes).
    {
      const { banGate } = await import('@/lib/security');
      const rej = await banGate(ip);
      if (rej) return NextResponse.json(rej.body, { status: rej.status, headers: { 'Retry-After': String(rej.retryAfter) } });
    }
    if (!(await rateLimit('quote-topup', ip, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS))) {
      return NextResponse.json(
        { error: { code: 'RATE_LIMITED', message: 'Too many quote requests. Silakan coba lagi nanti.' } },
        { status: 429 }
      );
    }
    
    const { readJsonBounded } = await import('@/lib/apiGuard');
    const body = schema.parse(await readJsonBounded(req));
    const quote = await createQuote('TOP_UP', body.asset, body.network, body.idrAmount);
    return ok({ quote });
  } catch (err) { return handleError(err); }
}


