import { NextRequest, NextResponse } from 'next/server';
import { ok } from '@/lib/response';
import { processTransfiWebhook } from '@/lib/orders';
import { parseTransfiWebhookPayload, verifyTransfiWebhookSignature } from '@/lib/transfi';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/webhooks/transfi
 *
 * TransFi onramp webhook handler.
 *
 * Signature verification (HMAC-SHA256):
 *   String to sign: <rawBody>
 *   Header:         X-Transfi-Hmac-Hash: <hex>
 *   Secret:         TRANSFI_WEBHOOK_SECRET (dedicated, from TransFi support)
 *
 * Even with a valid signature, a webhook is only a SIGNAL — all fulfillment
 * decisions are made after a server-to-server GET /v3/orders/{orderId}.
 * Idempotency via unique (orderId, eventId).
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
    if (!(await rateLimit('webhook-transfi', ip, RATE_LIMITS.webhook.max, RATE_LIMITS.webhook.windowMs))) {
      return NextResponse.json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }, { status: 429 });
    }

    const { readBoundedBody } = await import('@/lib/security');
    const rawBody = await readBoundedBody(req);

    const secret = (process.env.TRANSFI_WEBHOOK_SECRET ?? '').trim();
    const productionWebhook = process.env.NODE_ENV === 'production' || process.env.TRANSFI_MODE === 'production';
    if (productionWebhook && !secret) {
      console.error(JSON.stringify({ scope: 'transfi', operation: 'webhook', errorCategory: 'WEBHOOK_SECRET_MISSING_PROD' }));
      return NextResponse.json({ error: { code: 'WEBHOOK_NOT_CONFIGURED', message: 'Webhook unavailable' } }, { status: 503 });
    }

    const signature = req.headers.get('x-transfi-hmac-hash');
    if (!verifyTransfiWebhookSignature(rawBody, signature, secret)) {
      console.warn(JSON.stringify({ scope: 'transfi', operation: 'webhook', errorCategory: 'SIGNATURE_INVALID' }));
      return NextResponse.json({ error: { code: 'INVALID_SIGNATURE', message: 'Invalid signature' } }, { status: 401 });
    }

    // ── Parse body ────────────────────────────────────────────────────────────
    let raw: unknown;
    try {
      raw = JSON.parse(rawBody);
    } catch {
      console.warn(JSON.stringify({ scope: 'transfi', operation: 'webhook', errorCategory: 'MALFORMED_JSON' }));
      return ok({ received: false, error: 'Invalid payload' });
    }

    const parsed = parseTransfiWebhookPayload(raw);
    if (parsed.kind === 'invalid') {
      console.warn(JSON.stringify({
        scope: 'transfi', operation: 'webhook', errorCategory: 'INVALID_PAYLOAD', reason: parsed.reason,
      }));
      return ok({ received: false, error: 'Invalid payload' });
    }

    const result = await processTransfiWebhook({
      eventId: parsed.payload.eventId,
      orderId: parsed.payload.entityId,
      status: parsed.payload.status,
    });
    return ok({ received: true, ...result });
  } catch {
    console.error(JSON.stringify({ scope: 'transfi', operation: 'webhook', errorCategory: 'PROCESSING_ERROR' }));
    return ok({ received: false, error: 'Internal error' });
  }
}
