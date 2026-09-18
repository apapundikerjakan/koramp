/**
 * Fyas PPOB — Bank Transfer API Client
 * Docs: https://ppob.fyas.my.id/docs#transfer-bank
 *
 * Used for automatic IDR payout after crypto is confirmed on a sell order.
 *
 * SECURITY: FYAS_API_KEY must NEVER be exposed to the browser.
 * All calls go through Next.js server-side only.
 *
 * Supported bankCodes:
 *   bca, bni, bri, mandiri, bsm, kesejahteraan_ekonomi, artos
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type FyasBankTransferStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'SUCCESS'
  | 'FAILED'
  | 'REFUNDED';

export interface FyasBankTransfer {
  refId: string;
  bankCode: string;
  targetNumber: string;
  nominal: number;
  status: FyasBankTransferStatus;
  createdAt: string;
  updatedAt: string;
  note?: string | null;
}

export interface FyasResponse<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string; details?: unknown };
}

// ─── Bank code mapper ─────────────────────────────────────────────────────────
// Maps user-entered bank names (case-insensitive) to Fyas bankCode values.
// Any bank not in this map will use the fallback check in fyasBankCode().

const BANK_CODE_MAP: Record<string, string> = {
  // BCA
  bca: 'bca',
  'bank bca': 'bca',
  'bank central asia': 'bca',
  // BNI
  bni: 'bni',
  'bank bni': 'bni',
  'bank negara indonesia': 'bni',
  // BRI
  bri: 'bri',
  'bank bri': 'bri',
  'bank rakyat indonesia': 'bri',
  // Mandiri
  mandiri: 'mandiri',
  'bank mandiri': 'mandiri',
  // BSI
  bsi: 'bsm',
  bsm: 'bsm',
  'bank bsi': 'bsm',
  'bank syariah indonesia': 'bsm',
  'bank muamalat': 'bsm',
  // SeaBank
  seabank: 'kesejahteraan_ekonomi',
  'sea bank': 'kesejahteraan_ekonomi',
  'kesejahteraan ekonomi': 'kesejahteraan_ekonomi',
  'bank kesejahteraan ekonomi': 'kesejahteraan_ekonomi',
  // Bank Jago
  jago: 'artos',
  'bank jago': 'artos',
  artos: 'artos',
  'bank artos': 'artos',
};

/**
 * Resolve a user-supplied bank name to a Fyas bankCode.
 * Returns null if the bank is not supported.
 */
export function fyasBankCode(bankName: string): string | null {
  const key = bankName.trim().toLowerCase();
  return BANK_CODE_MAP[key] ?? null;
}

/** List all banks supported by Fyas for display in error messages */
export const FYAS_SUPPORTED_BANKS = [
  'BCA', 'BNI', 'BRI', 'Mandiri', 'BSI', 'SeaBank', 'Bank Jago',
];

// ─── Config ───────────────────────────────────────────────────────────────────

const FYAS_ALLOWED_HOSTS = new Set(['ppob.fyas.my.id']);

function getConfig() {
  const apiKey = process.env.FYAS_API_KEY;
  const rawBase = (process.env.FYAS_BASE_URL ?? 'https://ppob.fyas.my.id').replace(/\/$/, '');
  if (!apiKey) throw new Error('FYAS_API_KEY is not configured');
  let parsed: URL;
  try {
    parsed = new URL(rawBase);
  } catch {
    throw new Error('FYAS_BASE_URL is not a valid URL');
  }
  if (parsed.protocol !== 'https:' || !FYAS_ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error('FYAS_BASE_URL must be https://ppob.fyas.my.id');
  }
  return { apiKey, baseUrl: parsed.toString().replace(/\/$/, '') };
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function fyasRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const { apiKey, baseUrl } = getConfig();
  if (!path.startsWith('/api/')) throw new Error('[Fyas] unsupported API path');
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
      ...(options.headers ?? {}),
    },
    cache: 'no-store',
    signal: options.signal ?? AbortSignal.timeout(15_000),
  });

  const json = (await res.json()) as FyasResponse<T>;

  if (!res.ok || !json.success) {
    const code = json.error?.code ?? 'UNKNOWN';
    const msg = json.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`[Fyas] ${code}: ${msg}`);
  }

  return json.data;
}

// ─── Bank Transfer endpoints ──────────────────────────────────────────────────

/**
 * Initiate a bank transfer payout.
 *
 * @param bankCode   Fyas bankCode (use fyasBankCode() to resolve from user input)
 * @param accountNumber  Recipient account number
 * @param nominal    Amount in IDR (integer)
 * @param idempotencyKey  Unique key to prevent duplicate transfers (use order ID)
 */
export async function fyasCreateBankTransfer(opts: {
  bankCode: string;
  accountNumber: string;
  nominal: number;
  idempotencyKey: string;
}): Promise<FyasBankTransfer> {
  return fyasRequest<FyasBankTransfer>('/api/v1/bank-transfers', {
    method: 'POST',
    headers: { 'Idempotency-Key': opts.idempotencyKey },
    body: JSON.stringify({
      bankCode: opts.bankCode,
      targetNumber: opts.accountNumber,
      nominal: Math.round(opts.nominal),
    }),
  });
}

/**
 * Get transfer status by refId.
 * Poll this until status is SUCCESS, FAILED, or REFUNDED.
 */
export async function fyasGetBankTransfer(refId: string): Promise<FyasBankTransfer> {
  return fyasRequest<FyasBankTransfer>(`/api/v1/bank-transfers/${encodeURIComponent(refId)}`);
}

/**
 * Get current Fyas account balance (IDR).
 * Useful for health checks before initiating payouts.
 */
export async function fyasGetBalance(): Promise<{ balance: number }> {
  return fyasRequest<{ balance: number }>('/api/v1/balance');
}
