/**
 * KiPay API v1.2.0 server-side client.
 *
 * Docs: https://kipay.id/docs/api
 * OpenAPI: https://api.kipay.id/openapi.json
 *
 * Key changes vs v1.0:
 * - apiKey format is now qpg_... (Checkout ID)
 * - net_amount NOT returned by create/get — only in webhook payload
 * - fee_bearer field added ('merchant' | 'user')
 * - Webhook now signed: X-Webhook-Signature = sha256=HMAC-SHA256(<timestamp>.<delivery_id>.<rawBody>)
 * - QR is retrieved via GET /qr.png — qr_payload not in create response
 *
 * Security: apiKey is in the URL path (per-KiPay contract). Never log raw URLs.
 * Use redactKipayUrl() before logging.
 */

import { createHmac } from 'crypto';

// ─── Transaction types ────────────────────────────────────────────────────────

export interface KipayTransaction {
  trx_id: string;
  mode: 'sandbox' | 'production';
  requested_amount?: number;
  unique_code?: number;
  amount: number;
  fee_amount?: number;
  /** fee_bearer: 'merchant' (default) or 'user'.
   *  merchant: amount = requested_amount + unique_code
   *  user:     amount = requested_amount + unique_code + fee_amount */
  fee_bearer?: 'merchant' | 'user';
  status: 'pending' | 'paid' | 'expired';
  provider: string | null;
  note?: string | null;
  matched_at: string | null;
  created_at?: string;
  expires_at?: string | null;
}

/** Shape returned by POST /transactions (create). */
export interface KipayCreatedTransaction extends KipayTransaction {
  requested_amount: number;
  unique_code: number;
  fee_amount: number;
  created_at: string;
  expires_at: string | null;
}

export type KipayWebhookEvent = 'transaction.paid' | 'transaction.expired' | 'webhook.test';

export interface KipayWebhookPayload {
  event: KipayWebhookEvent;
  sent_at?: string;
  transaction?: {
    trx_id: string;
    status: string;
    amount: number;
    provider?: string | null;
    matched_at?: string | null;
    // webhook includes net_amount (not present in create/get response)
    net_amount?: number;
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const KIPAY_CUSTOMER_MESSAGE = 'Layanan pembayaran sedang tidak tersedia. Silakan coba lagi.';
export const KIPAY_API_HOST = 'api.kipay.id';
export const KIPAY_API_BASE_URL = 'https://api.kipay.id/api/pay';

// ─── Config ───────────────────────────────────────────────────────────────────

/**
 * Accept both documented base URL forms, normalise to canonical subdomain.
 *   https://api.kipay.id/api/pay  (canonical)
 *   https://kipay.id/api/pay      (also documented)
 */
function normalizeKipayBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('[KiPay] KIPAY_API_BASE_URL is not a valid URL');
  }

  const pathname = parsed.pathname.replace(/\/+$/, '');
  const isValidHost = parsed.hostname === 'api.kipay.id' || parsed.hostname === 'kipay.id';

  if (
    parsed.protocol !== 'https:'
    || !isValidHost
    || parsed.port
    || pathname !== '/api/pay'
    || parsed.search
    || parsed.hash
  ) {
    throw new Error(
      '[KiPay] KIPAY_API_BASE_URL must be https://api.kipay.id/api/pay or https://kipay.id/api/pay',
    );
  }
  return KIPAY_API_BASE_URL;
}

export function getKipayConfig() {
  const configuredBaseUrl = process.env.KIPAY_API_BASE_URL?.trim() ?? '';
  const apiKey = process.env.KIPAY_API_KEY?.trim() ?? '';
  const mode = (process.env.KIPAY_MODE ?? 'sandbox').trim();
  const webhookSecret = process.env.KIPAY_WEBHOOK_SECRET?.trim() ?? '';

  if (!configuredBaseUrl) throw new Error('[KiPay] KIPAY_API_BASE_URL is not configured');
  if (!apiKey) throw new Error('[KiPay] KIPAY_API_KEY is not configured');
  if (mode !== 'sandbox' && mode !== 'production') {
    throw new Error('[KiPay] KIPAY_MODE must be sandbox or production');
  }

  return { baseUrl: normalizeKipayBaseUrl(configuredBaseUrl), apiKey, mode, webhookSecret };
}

export function validateKipayConfig(): { mode: string; host: string; keyConfigured: boolean; signatureConfigured: boolean } {
  const { baseUrl, apiKey, mode, webhookSecret } = getKipayConfig();
  return {
    mode,
    host: new URL(baseUrl).host,
    keyConfigured: Boolean(apiKey),
    signatureConfigured: Boolean(webhookSecret),
  };
}

export function buildKipayUrl(path: string): string {
  const { baseUrl, apiKey } = getKipayConfig();
  const normalizedPath = `/${path.replace(/^\/+/, '')}`;
  if (!normalizedPath.startsWith('/transactions')) {
    throw new Error('[KiPay] unsupported API path');
  }
  return `${baseUrl}/${encodeURIComponent(apiKey)}${normalizedPath}`;
}

export function redactKipayUrl(url: string): string {
  return url.replace(/(\/api\/pay\/)[^/]+(\/)/, '$1{key}$2');
}

// ─── Webhook signature verification (v1.2.0) ─────────────────────────────────

/**
 * Verify KiPay webhook HMAC-SHA256 signature (API v1.2.0).
 *
 * Signature string: <X-Webhook-Timestamp>.<X-Webhook-Delivery>.<rawBody>
 * Header value:     sha256=<hex>
 *
 * Returns 'ok' when verified, 'no_secret' when KIPAY_WEBHOOK_SECRET not
 * configured (accepted with warning — backward compat), 'invalid' on mismatch.
 */
export function verifyKipayWebhookSignature(
  rawBody: string,
  headers: { timestamp?: string | null; delivery?: string | null; signature?: string | null },
): 'ok' | 'no_secret' | 'invalid' | 'missing_headers' {
  const { webhookSecret } = getKipayConfig();

  if (!webhookSecret) {
    // Secret not yet configured — accept but log (no_secret path allows
    // gradual rollout: configure secret in env to start enforcing).
    return 'no_secret';
  }

  const { timestamp, delivery, signature } = headers;
  if (!timestamp || !delivery || !signature) return 'missing_headers';

  const expected = `sha256=${createHmac('sha256', webhookSecret)
    .update(`${timestamp}.${delivery}.${rawBody}`)
    .digest('hex')}`;

  // Constant-time comparison to prevent timing attacks.
  if (expected.length !== signature.length) return 'invalid';
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0 ? 'ok' : 'invalid';
}

// ─── Error types ──────────────────────────────────────────────────────────────

export type KipayErrorCategory =
  | 'INVALID_REQUEST'
  | 'CONFIGURATION'
  | 'CONFLICT'
  | 'TRANSIENT'
  | 'UNKNOWN';

export class KiPayError extends Error {
  operation: string;
  httpStatus: number | null;
  category: KipayErrorCategory;
  trxId?: string;

  constructor(
    operation: string,
    category: KipayErrorCategory,
    message = KIPAY_CUSTOMER_MESSAGE,
    httpStatus: number | null = null,
    trxId?: string,
  ) {
    super(message);
    this.name = 'KiPayError';
    this.operation = operation;
    this.category = category;
    this.httpStatus = httpStatus;
    this.trxId = trxId;
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function logKipay(operation: string, fields: Record<string, unknown>): void {
  try {
    console.info(JSON.stringify({ scope: 'kipay', operation, ...fields }));
  } catch {
    // Logging must never change a payment decision.
  }
}

async function summarizeUpstreamResponse(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const data = JSON.parse(text) as { error?: unknown; message?: unknown };
    if (typeof data.error === 'string' && data.error) return `json_error:${data.error.slice(0, 120)}`;
    if (typeof data.message === 'string' && data.message) return `json_message:${data.message.slice(0, 120)}`;
    return 'json_response_without_error';
  } catch {
    return text.trim() ? 'non_json_response' : 'empty_response';
  }
}

const FETCH_TIMEOUT_MS = 15_000;

async function kipayFetch(
  operation: string,
  url: string,
  init: RequestInit & { trxId?: string },
): Promise<Response> {
  const startedAt = Date.now();
  const { trxId, ...fetchInit } = init;
  try {
    const res = await fetch(url, {
      ...fetchInit,
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    logKipay(operation, {
      mode: getKipayConfig().mode,
      httpStatus: res.status,
      trxId,
      durationMs: Date.now() - startedAt,
    });
    return res;
  } catch {
    logKipay(operation, {
      mode: getKipayConfig().mode,
      errorCategory: 'TRANSIENT',
      trxId,
      durationMs: Date.now() - startedAt,
      safeResponseSummary: 'network_or_timeout',
    });
    throw new KiPayError(operation, 'TRANSIENT', KIPAY_CUSTOMER_MESSAGE, null, trxId);
  }
}

function readJson(text: string, operation: string, status: number, trxId?: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new KiPayError(operation, 'CONFIGURATION', KIPAY_CUSTOMER_MESSAGE, status, trxId);
  }
}

function isKipayStatus(value: unknown): value is KipayTransaction['status'] {
  return value === 'pending' || value === 'paid' || value === 'expired';
}

function isKipayMode(value: unknown): value is KipayTransaction['mode'] {
  return value === 'sandbox' || value === 'production';
}

function validateTransactionResponse(
  value: unknown,
  operation: string,
  status: number,
  expectedTrxId?: string,
): KipayTransaction {
  const data = value as Partial<KipayTransaction>;
  if (
    !data || typeof data !== 'object'
    || typeof data.trx_id !== 'string' || !data.trx_id
    || !isKipayMode(data.mode)
    || typeof data.amount !== 'number' || !Number.isSafeInteger(data.amount) || data.amount <= 0
    || !isKipayStatus(data.status)
  ) {
    throw new KiPayError(operation, 'CONFIGURATION', KIPAY_CUSTOMER_MESSAGE, status, expectedTrxId);
  }
  if (expectedTrxId && data.trx_id !== expectedTrxId) {
    throw new KiPayError(operation, 'CONFIGURATION', KIPAY_CUSTOMER_MESSAGE, status, expectedTrxId);
  }
  return data as KipayTransaction;
}

/**
 * Validate the POST /transactions create response.
 *
 * v1.2.0: net_amount is NOT in the create/get response (only in webhook).
 * qr_payload is NOT in the JSON response — QR is fetched via GET /qr.png.
 * required_amount, unique_code, fee_amount and expires_at ARE present.
 */
function validateCreateResponse(value: unknown, status: number): KipayCreatedTransaction {
  const data = validateTransactionResponse(value, 'create_transaction', status);
  if (
    typeof data.requested_amount !== 'number' || !Number.isSafeInteger(data.requested_amount)
    || typeof data.unique_code !== 'number' || !Number.isSafeInteger(data.unique_code)
    || typeof data.fee_amount !== 'number' || !Number.isSafeInteger(data.fee_amount)
    || typeof data.created_at !== 'string'
    || (data.expires_at !== null && typeof data.expires_at !== 'string')
  ) {
    throw new KiPayError('create_transaction', 'CONFIGURATION', KIPAY_CUSTOMER_MESSAGE, status, data.trx_id);
  }
  // net_amount not present in v1.2.0 create response — do not require it.
  return data as KipayCreatedTransaction;
}

function categoryForStatus(status: number): KipayErrorCategory {
  if (status === 400) return 'INVALID_REQUEST';
  if (status === 404) return 'CONFIGURATION';
  if (status === 409) return 'CONFLICT';
  if (status >= 500) return 'TRANSIENT';
  return 'CONFIGURATION';
}

async function throwForUpstreamStatus(
  operation: string,
  res: Response,
  trxId?: string,
  categoryOverride?: KipayErrorCategory,
): Promise<never> {
  const category = categoryOverride ?? categoryForStatus(res.status);
  logKipay(operation, {
    mode: getKipayConfig().mode,
    httpStatus: res.status,
    trxId,
    errorCategory: category,
    safeResponseSummary: await summarizeUpstreamResponse(res),
  });
  throw new KiPayError(operation, category, KIPAY_CUSTOMER_MESSAGE, res.status, trxId);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * POST /transactions — create a QRIS payment transaction.
 *
 * Never retried: network errors and 5xx are ambiguous after the provider
 * creates a transaction. The caller moves the order to UNKNOWN state.
 */
export async function kipayCreateTransaction(opts: {
  amount: number;
  note: string;
}): Promise<KipayCreatedTransaction> {
  if (!Number.isSafeInteger(opts.amount) || opts.amount <= 0) {
    throw new KiPayError('create_transaction', 'INVALID_REQUEST', KIPAY_CUSTOMER_MESSAGE);
  }

  let res: Response;
  try {
    res = await kipayFetch('create_transaction', buildKipayUrl('/transactions'), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: opts.amount, note: opts.note }),
    });
  } catch (error) {
    if (error instanceof KiPayError) {
      throw new KiPayError('create_transaction', 'UNKNOWN', KIPAY_CUSTOMER_MESSAGE, error.httpStatus);
    }
    throw error;
  }

  if (res.status !== 201) {
    await throwForUpstreamStatus(
      'create_transaction',
      res,
      undefined,
      res.status >= 500 ? 'UNKNOWN' : undefined,
    );
  }

  const text = await res.text();
  return validateCreateResponse(readJson(text, 'create_transaction', res.status), res.status);
}

/** GET /transactions/:trxId — idempotent, retried with backoff on transient errors. */
export async function kipayGetTransaction(trxId: string): Promise<KipayTransaction> {
  if (!trxId || trxId.length > 100) {
    throw new KiPayError('get_transaction', 'INVALID_REQUEST', KIPAY_CUSTOMER_MESSAGE, null, trxId);
  }

  let lastError: KiPayError | undefined;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await kipayFetch(
        'get_transaction',
        buildKipayUrl(`/transactions/${encodeURIComponent(trxId)}`),
        { trxId },
      );
      if (res.ok) {
        const text = await res.text();
        return validateTransactionResponse(
          readJson(text, 'get_transaction', res.status, trxId),
          'get_transaction',
          res.status,
          trxId,
        );
      }
      await throwForUpstreamStatus('get_transaction', res, trxId);
    } catch (error) {
      const typed = error instanceof KiPayError
        ? error
        : new KiPayError('get_transaction', 'TRANSIENT', KIPAY_CUSTOMER_MESSAGE, null, trxId);
      lastError = typed;
      if (typed.category !== 'TRANSIENT' || attempt === 3) throw typed;
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1)));
    }
  }
  throw lastError ?? new KiPayError('get_transaction', 'TRANSIENT', KIPAY_CUSTOMER_MESSAGE, null, trxId);
}

/** GET /transactions/:trxId/qr.png — proxy to browser (keeps apiKey server-side). */
export async function kipayGetQrImage(trxId: string): Promise<Response> {
  return kipayFetch(
    'get_qr',
    buildKipayUrl(`/transactions/${encodeURIComponent(trxId)}/qr.png`),
    { trxId },
  );
}

/** POST /transactions/:trxId/simulate — sandbox only. */
export async function kipaySimulate(trxId: string, provider = 'shopeepay'): Promise<KipayTransaction> {
  const { mode } = getKipayConfig();
  if (mode === 'production' || process.env.NODE_ENV === 'production') {
    throw new KiPayError('simulate', 'INVALID_REQUEST', 'Simulasi tidak tersedia di production', null, trxId);
  }

  const res = await kipayFetch(
    'simulate',
    buildKipayUrl(`/transactions/${encodeURIComponent(trxId)}/simulate`),
    {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider }),
      trxId,
    },
  );
  if (!res.ok) await throwForUpstreamStatus('simulate', res, trxId);
  const text = await res.text();
  return validateTransactionResponse(
    readJson(text, 'simulate', res.status, trxId),
    'simulate',
    res.status,
    trxId,
  );
}

// ─── Webhook payload parser ───────────────────────────────────────────────────

export type ParsedWebhook =
  | { kind: 'test'; event: 'webhook.test'; sentAt?: string; headerEvent?: string }
  | {
      kind: 'event';
      event: 'transaction.paid' | 'transaction.expired';
      sentAt?: string;
      trxId: string;
      transaction: NonNullable<KipayWebhookPayload['transaction']>;
      headerEvent?: string;
    }
  | { kind: 'unsupported'; event: string }
  | { kind: 'invalid'; reason: string };

const KNOWN_EVENTS: readonly KipayWebhookEvent[] = [
  'transaction.paid',
  'transaction.expired',
  'webhook.test',
];

/**
 * Parse the documented KiPay v1.2.0 webhook payload.
 * webhook.test events include a transaction object — parse it loosely.
 */
export function parseKipayWebhookPayload(raw: unknown, headerEvent?: string): ParsedWebhook {
  if (!raw || typeof raw !== 'object') return { kind: 'invalid', reason: 'payload_not_object' };
  const payload = raw as Record<string, unknown>;
  const event = payload.event;
  if (typeof event !== 'string' || !event) return { kind: 'invalid', reason: 'missing_event' };
  if (!KNOWN_EVENTS.includes(event as KipayWebhookEvent)) return { kind: 'unsupported', event };

  const sentAt = typeof payload.sent_at === 'string' ? payload.sent_at : undefined;

  if (event === 'webhook.test') return { kind: 'test', event, sentAt, headerEvent };

  const transaction = payload.transaction;
  if (!transaction || typeof transaction !== 'object') {
    return { kind: 'invalid', reason: 'missing_transaction' };
  }
  const t = transaction as Record<string, unknown>;
  if (typeof t.trx_id !== 'string' || !t.trx_id) {
    return { kind: 'invalid', reason: 'missing_transaction_trx_id' };
  }
  if (!isKipayStatus(t.status)) {
    return { kind: 'invalid', reason: 'invalid_transaction_status' };
  }
  if (typeof t.amount !== 'number' || !Number.isSafeInteger(t.amount) || t.amount <= 0) {
    return { kind: 'invalid', reason: 'invalid_transaction_amount' };
  }
  if (
    (event === 'transaction.paid' && t.status !== 'paid')
    || (event === 'transaction.expired' && t.status !== 'expired')
  ) {
    return { kind: 'invalid', reason: 'event_status_mismatch' };
  }

  const transactionEvent = event as 'transaction.paid' | 'transaction.expired';

  return {
    kind: 'event',
    event: transactionEvent,
    sentAt,
    trxId: t.trx_id,
    transaction: {
      trx_id: t.trx_id,
      status: t.status,
      amount: t.amount,
      provider: typeof t.provider === 'string' ? t.provider : null,
      matched_at: typeof t.matched_at === 'string' ? t.matched_at : null,
      net_amount: typeof t.net_amount === 'number' ? t.net_amount : undefined,
    },
    headerEvent,
  };
}
