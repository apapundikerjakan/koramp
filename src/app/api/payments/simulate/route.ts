import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { kipaySimulate } from '@/lib/kipay';
import { ok, handleError } from '@/lib/response';
import { rateLimit, getClientIp } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

const schema = z.object({
  trxId: z.string().min(3).max(100),
  provider: z.string().min(2).max(50).optional().default('shopeepay'),
});

// Dev/sandbox only — simulate KiPay payment
export async function POST(req: NextRequest) {
  if (process.env.KIPAY_MODE === 'production' || process.env.NODE_ENV === 'production') {
    return ok({ error: 'Not available in production' }, 404);
  }
  try {
    const ip = getClientIp(req);
    // Ban gate: rejected before any expensive work (blockchain RPC, KiPay, DB writes).
    {
      const { banGate } = await import('@/lib/security');
      const rej = await banGate(ip);
      if (rej) return NextResponse.json(rej.body, { status: rej.status, headers: { 'Retry-After': String(rej.retryAfter) } });
    }
    if (!rateLimit('payments-simulate', ip, 10, 60_000)) {
      return NextResponse.json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }, { status: 429 });
    }
    const body = schema.parse(await req.json());
    const result = await kipaySimulate(body.trxId, body.provider);
    return ok({ result });
  } catch (err) { return handleError(err); }
}

