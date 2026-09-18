import { NextRequest, NextResponse } from 'next/server';
import { ok } from '@/lib/response';
import { processKipayWebhook } from '@/lib/orders';
import { parseKipayWebhookPayload, verifyKipayWebhookSignature } from '@/lib/kipay';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/webhooks/kipay
 *
 * KiPay v1.2.0 webhook handler.
 *
 * Signature verification (HMAC-SHA256):
 *   String to sign: <X-Webhook-Timestamp>.<X-Webhook-Delivery>.<rawBody>
 *   Header:         X-Webhook-Signature: sha256=<hex>
 *
 * If KIPAY_WEBHOOK_SECRET is not yet set, signature verification is skipped
 * with a warning (backward compat). Set KIPAY_WEBHOOK_SECRET in env to enforce.
 *
 * Even with a valid signature, a webhook is only a SIGNAL — all fulfillment
 * decisions are made after a server-to-server GET /transactions/{trxId}.
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
    if (!rateLimit('webhook-kipay', ip, RATE_LIMITS.webhook.max, RATE_LIMITS.webhook.windowMs)) {
      return NextResponse.json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }, { status: 429 });
    }

    const { readBoundedBody } = await import('@/lib/security');
    const rawBody = await readBoundedBody(req);

    // ── Signature verification (v1.2.0) ──────────────────────────────────────
    const sigResult = verifyKipayWebhookSignature(rawBody, {
      timestamp: req.headers.get('x-webhook-timestamp'),
      delivery:  req.headers.get('x-webhook-delivery'),
      signature: req.headers.get('x-webhook-signature'),
    });

    if (sigResult === 'invalid') {
      console.warn(JSON.stringify({
        scope: 'kipay', operation: 'webhook', errorCategory: 'SIGNATURE_INVALID',
      }));
      // Reject forged webhooks — still return 200 so KiPay doesn't retry.
      return ok({ received: false, error: 'Invalid signature' });
    }

    if (sigResult === 'no_secret') {
      // KIPAY_WEBHOOK_SECRET not configured — accept but warn.
      // In production this must be set; fulfillment still re-verifies
      // server-to-server so unsigned spam cannot mint value.
      if (process.env.NODE_ENV === 'production') {
        console.error(JSON.stringify({
          scope: 'kipay', operation: 'webhook',
          errorCategory: 'WEBHOOK_SECRET_MISSING_PROD',
        }));
      } else {
        console.warn(JSON.stringify({
          scope: 'kipay', operation: 'webhook',
          warning: 'KIPAY_WEBHOOK_SECRET not set — signature verification skipped',
        }));
      }
    }

    if (sigResult === 'missing_headers') {
      // Webhook from older KiPay or test call without signature headers.
      // Accept if no secret configured; reject if secret is configured.
      const { webhookSecret } = (await import('@/lib/kipay')).getKipayConfig();
      if (webhookSecret) {
        console.warn(JSON.stringify({
          scope: 'kipay', operation: 'webhook', errorCategory: 'SIGNATURE_HEADERS_MISSING',
        }));
        return ok({ received: false, error: 'Missing signature headers' });
      }
    }

    // ── Parse body ────────────────────────────────────────────────────────────
    let raw: unknown;
    try {
      raw = JSON.parse(rawBody);
    } catch {
      console.warn(JSON.stringify({ scope: 'kipay', operation: 'webhook', errorCategory: 'MALFORMED_JSON' }));
      return ok({ received: false, error: 'Invalid payload' });
    }

    const headerEvent = req.headers.get('x-webhook-event') ?? undefined;
    const parsed = parseKipayWebhookPayload(raw, headerEvent);

    if (parsed.kind === 'invalid') {
      console.warn(JSON.stringify({
        scope: 'kipay', operation: 'webhook', errorCategory: 'INVALID_PAYLOAD', reason: parsed.reason,
      }));
      return ok({ received: false, error: 'Invalid payload' });
    }
    if (parsed.kind === 'unsupported') {
      console.warn(JSON.stringify({
        scope: 'kipay', operation: 'webhook', errorCategory: 'UNSUPPORTED_EVENT', event: parsed.event,
      }));
      return ok({ received: false, error: 'Unsupported event' });
    }
    if (headerEvent && headerEvent !== parsed.event) {
      console.warn(JSON.stringify({ scope: 'kipay', operation: 'webhook', errorCategory: 'EVENT_MISMATCH' }));
      return ok({ received: false, error: 'Invalid payload' });
    }

    // ── Timestamp check (X-Webhook-Timestamp takes priority over sent_at) ────
    const timestampHeader = req.headers.get('x-webhook-timestamp') ?? parsed.sentAt;
    if (timestampHeader) {
      const ts = new Date(timestampHeader).getTime();
      const { webhookMaxAgeSec } = await import('@/lib/security');
      const maxAgeMs = webhookMaxAgeSec() * 1000; // clamped 60-3600s, default 300
      const now = Date.now();
      if (!Number.isFinite(ts) || ts > now + 5 * 60_000 || now - ts > maxAgeMs) {
        console.warn(JSON.stringify({ scope: 'kipay', operation: 'webhook', errorCategory: 'STALE_EVENT' }));
        return ok({ received: false, error: 'Stale event' });
      }
    }

    // ── Idempotency key from X-Webhook-Delivery ───────────────────────────────
    const deliveryId = req.headers.get('x-webhook-delivery') ?? undefined;

    if (parsed.kind === 'test') {
      console.info(JSON.stringify({ scope: 'kipay', operation: 'webhook_test', result: 'acknowledged' }));
      return ok({ received: true, test: true });
    }

    const result = await processKipayWebhook({
      event: parsed.event,
      sent_at: timestampHeader ?? undefined,
      deliveryId,
      trxId: parsed.trxId,
      transaction: parsed.transaction,
    });
    return ok({ received: true, ...result });
  } catch {
    console.error(JSON.stringify({ scope: 'kipay', operation: 'webhook', errorCategory: 'PROCESSING_ERROR' }));
    return ok({ received: false, error: 'Internal error' });
  }
}
