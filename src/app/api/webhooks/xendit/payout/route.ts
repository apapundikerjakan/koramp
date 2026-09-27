import { NextRequest, NextResponse } from 'next/server';
import { ok } from '@/lib/response';
import { processXenditPayoutWebhook } from '@/lib/orders';
import { parseXenditPayoutWebhook, verifyXenditCallbackToken } from '@/lib/xendit';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/webhooks/xendit/payout
 *
 * Auth: header `x-callback-token` equals XENDIT_WEBHOOK_TOKEN.
 * Events: v3_payout.succeeded | .failed | .reversed | .rejected | .pending_compliance.
 * Signal → server-side GET payout → converge. Idempotent via XenditWebhook.
 */
export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    {
      const { banGate } = await import('@/lib/security');
      const rej = await banGate(ip);
      if (rej) {
        return NextResponse.json(rej.body, { status: rej.status, headers: { 'Retry-After': String(rej.retryAfter) } });
      }
    }
    if (!(await rateLimit('webhook-xendit-payout', ip, RATE_LIMITS.webhook.max, RATE_LIMITS.webhook.windowMs))) {
      return NextResponse.json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }, { status: 429 });
    }

    const { readBoundedBody } = await import('@/lib/security');
    const rawBody = await readBoundedBody(req);

    const token = req.headers.get('x-callback-token');
    const expected = (process.env.XENDIT_WEBHOOK_TOKEN ?? '').trim();
    if (!expected) {
      console.error(JSON.stringify({ scope: 'xendit', operation: 'webhook-payout', errorCategory: 'WEBHOOK_SECRET_MISSING' }));
      return NextResponse.json({ error: { code: 'WEBHOOK_NOT_CONFIGURED', message: 'Webhook unavailable' } }, { status: 503 });
    }
    if (!verifyXenditCallbackToken(token, expected)) {
      console.warn(JSON.stringify({ scope: 'xendit', operation: 'webhook-payout', errorCategory: 'SIGNATURE_INVALID' }));
      return NextResponse.json({ error: { code: 'INVALID_SIGNATURE', message: 'Invalid signature' } }, { status: 401 });
    }

    let raw: unknown;
    try {
      raw = JSON.parse(rawBody);
    } catch {
      console.warn(JSON.stringify({ scope: 'xendit', operation: 'webhook-payout', errorCategory: 'MALFORMED_JSON' }));
      return ok({ received: false, error: 'Invalid payload' });
    }

    const parsed = parseXenditPayoutWebhook(raw);
    if (parsed.kind === 'invalid') {
      console.warn(JSON.stringify({
        scope: 'xendit', operation: 'webhook-payout', errorCategory: 'INVALID_PAYLOAD', reason: parsed.reason,
      }));
      return ok({ received: false, error: 'Invalid payload' });
    }

    const result = await processXenditPayoutWebhook({
      event: parsed.payload.event,
      payoutId: parsed.payload.payoutId,
      referenceId: parsed.payload.referenceId,
      status: parsed.payload.status,
    });
    return ok({ received: true, ...result });
  } catch {
    console.error(JSON.stringify({ scope: 'xendit', operation: 'webhook-payout', errorCategory: 'PROCESSING_ERROR' }));
    return ok({ received: false, error: 'Internal error' });
  }
}
