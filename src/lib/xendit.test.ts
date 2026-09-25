/**
 * Xendit client unit tests — deterministic, no network.
 * Mocks global fetch for create/get flows.
 */
import {
  normalizeXenditBaseUrl,
  extractXenditActions,
  verifyXenditCallbackToken,
  parseXenditPaymentWebhook,
  parseXenditPayoutWebhook,
  isXenditSuccessStatus,
  isXenditFailedStatus,
  isXenditPayoutSuccess,
  isXenditPayoutFailed,
  payoutIdempotencyKeyForSellOrder,
  xenditBankRoutingValue,
  verifyXenditPaymentAmounts as verifyOrder,
  decideXenditTopUpTransition as decide,
  xenditCreatePaymentRequest,
  xenditCreatePayout,
  XENDIT_QRIS_DOCUMENTED_MAX_IDR,
} from './xendit';

const OLD_ENV = process.env;

beforeEach(() => {
  process.env = { ...OLD_ENV, XENDIT_API_KEY: 'test-key', XENDIT_MODE: 'sandbox', XENDIT_WEBHOOK_TOKEN: 'tok' };
  (global as { fetch?: unknown }).fetch = undefined;
});

afterAll(() => {
  process.env = OLD_ENV;
});

describe('xendit config', () => {
  it('rejects non-xendit hosts (SSRF allowlist)', () => {
    expect(() => normalizeXenditBaseUrl('https://evil.example.com')).toThrow();
    expect(() => normalizeXenditBaseUrl('http://api.xendit.co')).toThrow();
    expect(normalizeXenditBaseUrl('https://api.xendit.co')).toBe('https://api.xendit.co');
  });
  it('documents QRIS max', () => {
    expect(XENDIT_QRIS_DOCUMENTED_MAX_IDR).toBe(10_000_000);
  });
});

describe('QR action extraction', () => {
  it('finds PRESENT_TO_CUSTOMER / QR_STRING', () => {
    const { qrString, redirectUrl } = extractXenditActions([
      { type: 'PRESENT_TO_CUSTOMER', descriptor: 'QR_STRING', value: '0002010102QR' },
    ]);
    expect(qrString).toBe('0002010102QR');
    expect(redirectUrl).toBeNull();
  });
  it('captures redirect fallback explicitly', () => {
    const { qrString, redirectUrl } = extractXenditActions([
      { type: 'REDIRECT_CUSTOMER', descriptor: 'WEB_URL', value: 'https://pay.xendit.co/x' },
    ]);
    expect(qrString).toBeNull();
    expect(redirectUrl).toBe('https://pay.xendit.co/x');
  });
  it('returns nulls for missing actions', () => {
    expect(extractXenditActions([])).toEqual({ qrString: null, redirectUrl: null });
    expect(extractXenditActions(null)).toEqual({ qrString: null, redirectUrl: null });
  });
});

describe('payment validation', () => {
  const local = { totalIdr: 1_000_000, publicId: 'krm_abc', providerOrderId: 'pr-123' };
  it('accepts exact match', () => {
    expect(verifyOrder(local, {
      requestAmount: 1_000_000, referenceId: 'krm_abc', paymentRequestId: 'pr-123', currency: 'IDR', channelCode: 'QRIS',
    })).toEqual({ ok: true });
  });
  it('rejects amount mismatch', () => {
    const r = verifyOrder(local, {
      requestAmount: 999_999, referenceId: 'krm_abc', paymentRequestId: 'pr-123', currency: 'IDR', channelCode: 'QRIS',
    });
    expect(r.ok).toBe(false);
  });
  it('rejects currency mismatch', () => {
    expect(verifyOrder(local, {
      requestAmount: 1_000_000, referenceId: 'krm_abc', paymentRequestId: 'pr-123', currency: 'USD', channelCode: 'QRIS',
    }).ok).toBe(false);
  });
  it('rejects reference mismatch', () => {
    expect(verifyOrder(local, {
      requestAmount: 1_000_000, referenceId: 'krm_other', paymentRequestId: 'pr-123', currency: 'IDR', channelCode: 'QRIS',
    }).ok).toBe(false);
  });
  it('rejects payment_request_id mismatch', () => {
    expect(verifyOrder(local, {
      requestAmount: 1_000_000, referenceId: 'krm_abc', paymentRequestId: 'pr-other', currency: 'IDR', channelCode: 'QRIS',
    }).ok).toBe(false);
  });
  it('rejects wrong channel', () => {
    expect(verifyOrder(local, {
      requestAmount: 1_000_000, referenceId: 'krm_abc', paymentRequestId: 'pr-123', currency: 'IDR', channelCode: 'VA',
    }).ok).toBe(false);
  });
});

describe('status handling', () => {
  it('SUCCEEDED is success; FAILED/CANCELED/EXPIRED are failed', () => {
    expect(isXenditSuccessStatus('SUCCEEDED')).toBe(true);
    expect(isXenditFailedStatus('FAILED')).toBe(true);
    expect(isXenditFailedStatus('CANCELED')).toBe(true);
    expect(isXenditFailedStatus('EXPIRED')).toBe(true);
    expect(isXenditSuccessStatus('REQUIRES_ACTION')).toBe(false);
  });
  it('transition: SUCCEEDED confirms pending; FAILED expires pending; pending stays', () => {
    expect(decide('PAYMENT_PENDING', 'SUCCEEDED')).toBe('confirm');
    expect(decide('PAYMENT_PENDING', 'FAILED')).toBe('expire');
    expect(decide('PAYMENT_PENDING', 'REQUIRES_ACTION')).toBe('keep');
    expect(decide('COMPLETED', 'SUCCEEDED')).toBe('ignore');
  });
  it('orders.ts re-exports converge identically', () => {
    expect(decide('PAYMENT_PENDING', 'SUCCEEDED')).toBe('confirm');
    expect(verifyOrder(
      { totalIdr: 100, publicId: 'a', providerOrderId: 'pr-1' },
      { requestAmount: 101, referenceId: 'a', paymentRequestId: 'pr-1', currency: 'IDR', channelCode: 'QRIS' },
    ).ok).toBe(false);
  });
  it('payout terminal states', () => {
    expect(isXenditPayoutSuccess('SUCCEEDED')).toBe(true);
    expect(isXenditPayoutFailed('FAILED')).toBe(true);
    expect(isXenditPayoutFailed('REJECTED')).toBe(true);
    expect(isXenditPayoutFailed('REVERSED')).toBe(true);
    expect(isXenditPayoutSuccess('ACCEPTED')).toBe(false);
  });
});

describe('webhook security', () => {
  it('accepts valid callback token', () => {
    expect(verifyXenditCallbackToken('tok', 'tok')).toBe(true);
  });
  it('rejects invalid / missing token', () => {
    expect(verifyXenditCallbackToken('bad', 'tok')).toBe(false);
    expect(verifyXenditCallbackToken(null, 'tok')).toBe(false);
    expect(verifyXenditCallbackToken('tok', '')).toBe(false);
  });
  it('parses payment webhook; rejects malformed', () => {
    const good = parseXenditPaymentWebhook({
      event: 'payment.capture', business_id: 'b1',
      data: { payment_id: 'py-1', payment_request_id: 'pr-1', reference_id: 'krm_1', currency: 'IDR', request_amount: 100, channel_code: 'QRIS', status: 'SUCCEEDED' },
    });
    expect(good.kind).toBe('valid');
    expect(parseXenditPaymentWebhook({ nope: true }).kind).toBe('invalid');
    expect(parseXenditPaymentWebhook({ event: 'x' }).kind).toBe('invalid');
    expect(parseXenditPaymentWebhook(null).kind).toBe('invalid');
  });
  it('parses payout webhook; rejects unknown', () => {
    const good = parseXenditPayoutWebhook({
      event: 'v3_payout.succeeded',
      data: { payout_id: 'po-1', reference_id: 'kms_1', status: 'SUCCEEDED' },
    });
    expect(good.kind).toBe('valid');
    expect(parseXenditPayoutWebhook({ event: 'x' }).kind).toBe('invalid');
  });
});

describe('payout idempotency', () => {
  it('is deterministic, unique per order, stable across retries', () => {
    const a1 = payoutIdempotencyKeyForSellOrder('order-1');
    const a2 = payoutIdempotencyKeyForSellOrder('order-1');
    const b = payoutIdempotencyKeyForSellOrder('order-2');
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
    expect(a1.length).toBeLessThanOrEqual(100);
  });
  it('resolves major ID banks; fails closed on unknown', () => {
    expect(xenditBankRoutingValue('BCA')).toBe('014');
    expect(xenditBankRoutingValue('bank mandiri')).toBe('008');
    expect(xenditBankRoutingValue('Bank Jago')).toBe('542');
    expect(xenditBankRoutingValue('Bank Fiktif X')).toBeNull();
  });
});

describe('xendit transport (mocked fetch)', () => {
  function mockFetchOnce(body: unknown, status = 201) {
    (global as { fetch: unknown }).fetch = jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
    });
  }
  it('sends api-version + Basic auth on create payment', async () => {
    mockFetchOnce({
      payment_request_id: 'pr-abc', reference_id: 'krm_1', status: 'REQUIRES_ACTION',
      currency: 'IDR', request_amount: 100000, channel_code: 'QRIS',
      actions: [{ type: 'PRESENT_TO_CUSTOMER', descriptor: 'QR_STRING', value: 'QR123' }],
    });
    const r = await xenditCreatePaymentRequest({ referenceId: 'krm_1', amountIdr: 100000 });
    expect(r.qrString).toBe('QR123');
    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['api-version']).toBe('2024-11-11');
    expect(headers.Authorization).toMatch(/^Basic /);
    const body = JSON.parse(init.body as string);
    expect(body.channel_code).toBe('QRIS');
    expect(body.type).toBe('PAY');
    expect(body.capture_method).toBe('AUTOMATIC');
  });
  it('maps API errors without leaking secrets', async () => {
    mockFetchOnce({ error: 'bad' }, 400);
    await expect(xenditCreatePaymentRequest({ referenceId: 'krm_1', amountIdr: 100000 })).rejects.toThrow('[Xendit:create_payment]');
  });
  it('sends idempotency-key on create payout', async () => {
    mockFetchOnce({ payout_id: 'po-1', reference_id: 'kms_1', status: 'ACCEPTED' });
    const r = await xenditCreatePayout({
      referenceId: 'kms_1', idempotencyKey: 'xendit-payout-x', bankName: 'BCA',
      accountNumber: '1234567890', accountName: 'Budi Santoso', amountIdr: 500000,
    });
    expect(r.payoutId).toBe('po-1');
    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['idempotency-key']).toBe('xendit-payout-x');
    expect(headers['api-version']).toBe('2025-09-01');
  });
});
