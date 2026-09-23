/**
 * TransFi API v3 server-side client (BUY onramp ONLY — sole BUY provider).
 *
 * Docs: https://docs.transfi.com (Transfer API - Onramp, current v3, NOT v1.0)
 *
 * Contract summary (verified against current docs):
 * - Auth: HTTP Basic username:password on every request, server-side only.
 * - `mid` header required. Sandbox needs no KYB; production does.
 * - Create: POST /v3/orders {userId(UX-), orderType:onramp, purposeCode,
 *   partnerId, source{currency,paymentType,paymentCode?,amount},
 *   destination{currency,walletAddress,additionalPaymentDetails{walletsOwner}}}.
 * - Response: {orderId OR-..., payUrl, paymentsData{type,qrCode?}, feeData,
 *   quoteHistory}. QR string renders client-side; payUrl is fallback redirect.
 * - Status: GET /v3/orders/{orderId} (also with mid header).
 * - Webhook: HMAC-SHA256 hex over RAW body, header X-Transfi-Hmac-Hash,
 *   dedicated secret from TransFi support. Event idempotency via eventId.
 * - Sandbox simulation: POST /v3/simulation/order {orderId,status} (sandbox only).
 *
 * Security: credentials never leave server. Never log raw URLs/bodies/secrets.
 */

import { createHmac, timingSafeEqual } from 'crypto';

// ─── Status model ───────────────────────────────────────────────────────────

export type TransfiOrderStatus =
  | 'initiated'
  | 'fund_processing'
  | 'fund_deposited'
  | 'fund_deposit_failed'
  | 'asset_processing'
  | 'asset_settled'
  | 'asset_settle_failed'
  | 'expired';

const TERMINAL_SUCCESS: TransfiOrderStatus[] = ['asset_settled'];
const TERMINAL_FAILURE: TransfiOrderStatus[] = ['fund_deposit_failed', 'asset_settle_failed', 'expired'];

export function isTransfiStatus(v: unknown): v is TransfiOrderStatus {
  return (
    v === 'initiated' || v === 'fund_processing' || v === 'fund_deposited' ||
    v === 'fund_deposit_failed' || v === 'asset_processing' || v === 'asset_settled' ||
    v === 'asset_settle_failed' || v === 'expired'
  );
}

export interface TransfiOrder {
  orderId: string;
  status: TransfiOrderStatus;
  payUrl?: string | null;
  qrCode?: string | null;
  qrType?: string | null;
  fiatAmount?: number;
  cryptoAmount?: number | null;
  fiatTicker?: string;
  cryptoTicker?: string;
  walletAddress?: string;
  feeData?: {
    depositAmount?: number;
    withdrawAmount?: number;
    exchangeRate?: number;
    totalFee?: number;
  } | null;
  raw?: unknown;
}

export type TransfiWebhookEvent =
  | 'initiated'
  | 'fund_deposited'
  | 'fund_deposit_failed'
  | 'asset_settled'
  | 'asset_settle_failed'
  | 'expired';

// ─── Errors ─────────────────────────────────────────────────────────────────

export type TransfiErrorCategory =
  | 'INVALID_REQUEST' // 400 — deterministic, do not retry blindly
  | 'NOT_FOUND' // 404
  | 'CONFLICT' // 409
  | 'RATE_LIMITED' // 429
  | 'TRANSIENT' // 5xx / network — safe to retry reads, never duplicate creates
  | 'UNKNOWN' // ambiguous (timeout) — never auto-duplicate a create
  | 'CONFIGURATION'; // missing env, contract violation

export class TransfiError extends Error {
  operation: string;
  category: TransfiErrorCategory;
  httpStatus: number | null;
  orderId?: string;
  constructor(operation: string, category: TransfiErrorCategory, httpStatus: number | null = null, orderId?: string) {
    super(`[TransFi:${operation}] ${category}`);
    this.name = 'TransFiError';
    this.operation = operation;
    this.category = category;
    this.httpStatus = httpStatus;
    this.orderId = orderId;
  }
}

export const TRANSFI_CUSTOMER_MESSAGE = 'Layanan pembayaran sedang tidak tersedia. Silakan coba lagi.';

// ─── Config ─────────────────────────────────────────────────────────────────

export const TRANSFI_SANDBOX_BASE_URL = 'https://sandbox-api.transfi.com';
export const TRANSFI_PROD_BASE_URL = 'https://api.transfi.com';

/** Hosts TransFi documents across pages (sandbox + production). */
const ALLOWED_HOSTS = new Set(['sandbox-api.transfi.com', 'api.transfi.com']);

export interface TransfiConfig {
  baseUrl: string;
  username: string;
  /** Present but never logged/returned. */
  password: string;
  mid: string;
  mode: 'sandbox' | 'production';
  webhookSecret: string;
}

export function normalizeTransfiBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('[TransFi] TRANSFI_API_BASE_URL is not a valid URL');
  }
  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname) || parsed.port || parsed.search || parsed.hash) {
    throw new Error('[TransFi] TRANSFI_API_BASE_URL must be https://sandbox-api.transfi.com or https://api.transfi.com');
  }
  return `${parsed.protocol}//${parsed.hostname}`;
}

export function getTransfiConfig(): TransfiConfig {
  const baseUrl = (process.env.TRANSFI_API_BASE_URL ?? TRANSFI_SANDBOX_BASE_URL).trim();
  const username = (process.env.TRANSFI_USERNAME ?? '').trim();
  const password = (process.env.TRANSFI_PASSWORD ?? '').trim();
  const mid = (process.env.TRANSFI_MID ?? '').trim();
  const mode = (process.env.TRANSFI_MODE ?? 'sandbox').trim();
  const webhookSecret = (process.env.TRANSFI_WEBHOOK_SECRET ?? '').trim();
  if (mode !== 'sandbox' && mode !== 'production') {
    throw new Error('[TransFi] TRANSFI_MODE must be sandbox or production');
  }
  if (!username || !password) throw new Error('[TransFi] TRANSFI_USERNAME/PASSWORD is not configured');
  if (!mid) throw new Error('[TransFi] TRANSFI_MID is not configured');
  if (mode === 'production' && !webhookSecret) {
    throw new Error('[TransFi] TRANSFI_WEBHOOK_SECRET must be configured in production');
  }
  if (mode === 'production' && normalizeTransfiBaseUrl(baseUrl) !== TRANSFI_PROD_BASE_URL) {
    throw new Error('[TransFi] production mode requires the production API host');
  }
  return { baseUrl: normalizeTransfiBaseUrl(baseUrl), username, password, mid, mode, webhookSecret };
}

function basicAuthHeader(cfg: TransfiConfig): string {
  return `Basic ${Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64')}`;
}

function midHeader(cfg: TransfiConfig): string {
  return cfg.mid;
}

// ─── Transport ──────────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 15_000;

function redactForLog(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}${u.pathname}`;
  } catch {
    return '<invalid-url>';
  }
}

async function transfiFetch(
  operation: string,
  url: string,
  init: RequestInit,
  orderId?: string,
): Promise<Response> {
  const startedAt = Date.now();
  try {
    const res = await fetch(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    return res;
  } catch {
    throw new TransfiError(operation, 'TRANSIENT', null, orderId);
  } finally {
    void startedAt;
    void redactForLog;
  }
}

function categoryForStatus(status: number): TransfiErrorCategory {
  if (status === 400) return 'INVALID_REQUEST';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'TRANSIENT';
  return 'CONFIGURATION';
}

async function throwForUpstreamStatus(operation: string, res: Response, orderId?: string): Promise<never> {
  throw new TransfiError(operation, categoryForStatus(res.status), res.status, orderId);
}

function readJson(text: string, operation: string, status: number): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new TransfiError(operation, 'CONFIGURATION', status);
  }
}

// ─── Order payload ──────────────────────────────────────────────────────────

export interface TransfiCreateOnrampInput {
  /** TransFi sender (UX-) — operator-provisioned; KORAMP collects no PII. */
  userId: string;
  /** KORAMP publicId — one KORAMP order = one TransFi order. */
  partnerId: string;
  purposeCode: string;
  purposeCodeReason?: string;
  sourceCurrency: string; // e.g. 'IDR'
  sourceAmount: number; // integer minor units as documented (KORAMP totalIdr, rounded)
  paymentType?: string; // e.g. resolved per-MID payment method config
  paymentCode?: string;
  destinationCurrency: string; // TransFi cryptoTicker, e.g. native per list-tokens
  walletAddress: string;
  successRedirectUrl?: string;
  failureRedirectUrl?: string;
  locale?: string;
}

export function buildOnrampPayload(input: TransfiCreateOnrampInput): Record<string, unknown> {
  if (!/^UX-/.test(input.userId)) throw new TransfiError('create_order', 'INVALID_REQUEST');
  if (!input.partnerId) throw new TransfiError('create_order', 'INVALID_REQUEST');
  if (!Number.isSafeInteger(input.sourceAmount) || input.sourceAmount <= 0) {
    throw new TransfiError('create_order', 'INVALID_REQUEST');
  }
  if (!input.walletAddress) throw new TransfiError('create_order', 'INVALID_REQUEST');
  return {
    userId: input.userId,
    orderType: 'onramp',
    purposeCode: input.purposeCode,
    ...(input.purposeCodeReason ? { purposeCodeReason: input.purposeCodeReason } : {}),
    partnerId: input.partnerId,
    ...(input.successRedirectUrl ? { successRedirectUrl: input.successRedirectUrl } : {}),
    ...(input.failureRedirectUrl ? { failureRedirectUrl: input.failureRedirectUrl } : {}),
    customization: { locale: input.locale ?? 'id' },
    source: {
      currency: input.sourceCurrency,
      ...(input.paymentType ? { paymentType: input.paymentType } : {}),
      ...(input.paymentCode ? { paymentCode: input.paymentCode } : {}),
      amount: input.sourceAmount,
    },
    destination: {
      currency: input.destinationCurrency,
      walletAddress: input.walletAddress,
      additionalPaymentDetails: { walletOwner: 'self', userConfirmed: true },
    },
  };
}

// ─── API calls ──────────────────────────────────────────────────────────────

function validateOrderResponse(value: unknown, operation: string): TransfiOrder {
  const data = value as Record<string, unknown>;
  if (!data || typeof data !== 'object' || typeof data.orderId !== 'string' || !data.orderId) {
    throw new TransfiError(operation, 'CONFIGURATION');
  }
  const status = (data as { status?: unknown }).status;
  if (!isTransfiStatus(status)) throw new TransfiError(operation, 'CONFIGURATION');
  const paymentsData = (data as { paymentsData?: { type?: unknown; qrCode?: unknown } }).paymentsData;
  const feeData = (data as { feeData?: TransfiOrder['feeData'] }).feeData;
  return {
    orderId: data.orderId,
    status,
    payUrl: typeof data.payUrl === 'string' ? (data.payUrl as string) : null,
    qrCode: typeof paymentsData?.qrCode === 'string' ? (paymentsData.qrCode as string) : null,
    qrType: typeof paymentsData?.type === 'string' ? (paymentsData.type as string) : null,
    feeData: feeData ?? null,
    raw: undefined,
  };
}

/** Create TransFi onramp order. Never retried automatically (no duplicate orders). */
export async function transfiCreateOnrampOrder(
  input: TransfiCreateOnrampInput,
  cfg: TransfiConfig = getTransfiConfig(),
): Promise<TransfiOrder> {
  const body = buildOnrampPayload(input);
  let res: Response;
  try {
    res = await transfiFetch('create_order', `${cfg.baseUrl}/v3/orders`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: basicAuthHeader(cfg),
        mid: midHeader(cfg),
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    if (e instanceof TransfiError) throw new TransfiError('create_order', 'UNKNOWN');
    throw e;
  }
  if (res.status !== 200 && res.status !== 201) {
    await throwForUpstreamStatus('create_order', res);
  }
  const text = await res.text();
  return validateOrderResponse(readJson(text, 'create_order', res.status), 'create_order');
}

/** Get TransFi order status. Idempotent; retried on transient errors. */
export async function transfiGetOrder(
  orderId: string,
  cfg: TransfiConfig = getTransfiConfig(),
): Promise<TransfiOrder> {
  if (!orderId || orderId.length > 100) throw new TransfiError('get_order', 'INVALID_REQUEST');
  let lastError: TransfiError | undefined;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await transfiFetch('get_order', `${cfg.baseUrl}/v3/orders/${encodeURIComponent(orderId)}`, {
        headers: { Accept: 'application/json', Authorization: basicAuthHeader(cfg), mid: midHeader(cfg) },
      }, orderId);
      if (res.ok) {
        const text = await res.text();
        const wrapped = readJson(text, 'get_order', res.status) as { status?: string; data?: unknown };
        // Envelope is {status:'success', data:{...order}} — unwrap defensively.
        const orderData = (wrapped as { data?: unknown }).data ?? wrapped;
        return validateOrderResponse(orderData, 'get_order');
      }
      await throwForUpstreamStatus('get_order', res, orderId);
    } catch (error) {
      const typed = error instanceof TransfiError
        ? error
        : new TransfiError('get_order', 'TRANSIENT', null, orderId);
      lastError = typed;
      if (typed.category !== 'TRANSIENT' || attempt === 3) throw typed;
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1)));
    }
  }
  throw lastError ?? new TransfiError('get_order', 'TRANSIENT', null, orderId);
}

/** Sandbox-only order simulation (drives status + webhooks). Refuses production. */
export async function transfiSimulateOrderStatus(
  orderId: string,
  status: TransfiOrderStatus,
  cfg: TransfiConfig = getTransfiConfig(),
): Promise<{ accepted: boolean }> {
  if (cfg.mode === 'production' || process.env.NODE_ENV === 'production') {
    throw new TransfiError('simulate_order', 'INVALID_REQUEST');
  }
  if (!isTransfiStatus(status)) throw new TransfiError('simulate_order', 'INVALID_REQUEST');
  const res = await transfiFetch('simulate_order', `${cfg.baseUrl}/v3/simulation/order`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: basicAuthHeader(cfg),
      mid: midHeader(cfg),
    },
    body: JSON.stringify({ orderId, status }),
  }, orderId);
  if (res.status !== 200 && res.status !== 202) {
    await throwForUpstreamStatus('simulate_order', res, orderId);
  }
  return { accepted: true };
}

/** GET /v3/balance — connectivity/auth check (no funds movement). */
export async function transfiGetBalance(cfg: TransfiConfig = getTransfiConfig()): Promise<{ ok: boolean; httpStatus: number }> {
  const res = await transfiFetch('get_balance', `${cfg.baseUrl}/v3/balance`, {
    headers: { Accept: 'application/json', Authorization: basicAuthHeader(cfg), mid: midHeader(cfg) },
  });
  return { ok: res.ok, httpStatus: res.status };
}

// ─── Webhook ────────────────────────────────────────────────────────────────

export interface TransfiWebhookPayload {
  eventId: string;
  entityId: string;
  entityType: string;
  status: TransfiOrderStatus;
  mid?: string;
  raw: unknown;
}

/** HMAC-SHA256 hex over RAW body with dedicated secret. Timing-safe compare. */
export function verifyTransfiWebhookSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature.trim(), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function parseTransfiWebhookPayload(value: unknown):
  | { kind: 'valid'; payload: TransfiWebhookPayload }
  | { kind: 'invalid'; reason: string } {
  const v = value as Record<string, unknown>;
  if (!v || typeof v !== 'object') return { kind: 'invalid', reason: 'not-an-object' };
  const { eventId, entityId, entityType, status } = v as Record<string, unknown>;
  if (typeof eventId !== 'string' || !eventId) return { kind: 'invalid', reason: 'missing-eventId' };
  if (typeof entityId !== 'string' || !entityId) return { kind: 'invalid', reason: 'missing-entityId' };
  if (!isTransfiStatus(status)) return { kind: 'invalid', reason: 'unknown-status' };
  return {
    kind: 'valid',
    payload: {
      eventId,
      entityId,
      entityType: typeof entityType === 'string' ? entityType : 'order',
      status: status as TransfiOrderStatus,
      mid: typeof v.mid === 'string' ? (v.mid as string) : undefined,
      raw: value,
    },
  };
}

/**
 * KORAMP delivery guard (pure — unit-tested).
 * TransFi orders settle directly to the user wallet; KORAMP delivery
 * (platform broadcast) must never trigger for them. Legacy/unknown
 * providers keep the old delivery path.
 */
export function shouldSkipKipremDelivery(provider?: string | null): boolean {
  return provider === 'transfi';
}

/**
 * KORAMP transition decision from a TransFi status (pure — unit-testable).
 * Direct-to-user settlement: asset_settled completes the order WITHOUT any
 * KORAMP crypto delivery step.
 */
export function decideTransfiTransition(
  orderStatus: string,
  transfiStatus: TransfiOrderStatus,
): 'confirm' | 'expire' | 'keep' | 'ignore' | 'complete' {
  const pending = ['CREATED', 'PAYMENT_PENDING', 'PAYMENT_CREATE_UNKNOWN'].includes(orderStatus);
  switch (transfiStatus) {
    case 'fund_deposited':
      return pending ? 'confirm' : 'ignore';
    case 'asset_settled':
      return ['PAYMENT_CONFIRMED', 'CRYPTO_PROCESSING', ...['CREATED', 'PAYMENT_PENDING', 'PAYMENT_CREATE_UNKNOWN']].includes(orderStatus)
        ? 'complete'
        : 'ignore';
    case 'fund_deposit_failed':
    case 'expired':
      return pending ? 'expire' : 'ignore';
    case 'asset_settle_failed':
      return ['PAYMENT_CONFIRMED', 'CRYPTO_PROCESSING'].includes(orderStatus) ? 'expire' : 'ignore';
    default:
      return 'keep'; // initiated/fund_processing/asset_processing → wait
  }
}
