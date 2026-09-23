import crypto from 'crypto';
import {
  verifyTransfiWebhookSignature,
  parseTransfiWebhookPayload,
  decideTransfiTransition,
  buildOnrampPayload,
  normalizeTransfiBaseUrl,
  getTransfiConfig,
  TransfiError,
  shouldSkipKipremDelivery,
} from './transfi';

describe('KORAMP delivery guard (no second delivery for TransFi)', () => {
  test('transfi orders skip KORAMP delivery', () => {
    expect(shouldSkipKipremDelivery('transfi')).toBe(true);
  });

  test('legacy/unknown providers keep delivery path', () => {
    expect(shouldSkipKipremDelivery(undefined)).toBe(false);
    expect(shouldSkipKipremDelivery(null)).toBe(false);
    expect(shouldSkipKipremDelivery('')).toBe(false);
    expect(shouldSkipKipremDelivery('kipay')).toBe(false);
  });
});

describe('webhook signature (HMAC-SHA256, timing-safe)', () => {
  const secret = 'test-dedicated-secret';
  const body = '{"eventId":"EV-1","entityId":"OR-1","status":"fund_deposited"}';

  test('valid signature verifies', () => {
    const sig = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
    expect(verifyTransfiWebhookSignature(body, sig, secret)).toBe(true);
  });

  test('forged signature rejected', () => {
    expect(verifyTransfiWebhookSignature(body, '0'.repeat(64), secret)).toBe(false);
  });

  test('wrong secret rejected', () => {
    const sig = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
    expect(verifyTransfiWebhookSignature(body, sig, 'other-secret')).toBe(false);
  });

  test('tampered body rejected', () => {
    const sig = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
    expect(verifyTransfiWebhookSignature(body + ' ', sig, secret)).toBe(false);
  });

  test('missing signature/secret rejected', () => {
    expect(verifyTransfiWebhookSignature(body, null, secret)).toBe(false);
    expect(verifyTransfiWebhookSignature(body, 'abc', '')).toBe(false);
  });
});

describe('webhook payload parsing', () => {
  test('valid onramp event parses', () => {
    const r = parseTransfiWebhookPayload({ eventId: 'EV-1', entityId: 'OR-1', entityType: 'order', status: 'asset_settled' });
    expect(r.kind).toBe('valid');
  });

  test('missing eventId/entityId/unknown status rejected', () => {
    expect(parseTransfiWebhookPayload({ entityId: 'OR-1', status: 'fund_deposited' }).kind).toBe('invalid');
    expect(parseTransfiWebhookPayload({ eventId: 'EV-1', status: 'fund_deposited' }).kind).toBe('invalid');
    expect(parseTransfiWebhookPayload({ eventId: 'EV-1', entityId: 'OR-1', status: 'bogus' }).kind).toBe('invalid');
    expect(parseTransfiWebhookPayload(null).kind).toBe('invalid');
  });
});

describe('status mapping (direct-to-user settlement, no KORAMP delivery)', () => {
  test('fund_deposited confirms pending orders only', () => {
    expect(decideTransfiTransition('PAYMENT_PENDING', 'fund_deposited')).toBe('confirm');
    expect(decideTransfiTransition('COMPLETED', 'fund_deposited')).toBe('ignore');
  });

  test('asset_settled completes without KORAMP delivery step', () => {
    for (const s of ['CREATED', 'PAYMENT_PENDING', 'PAYMENT_CONFIRMED', 'CRYPTO_PROCESSING']) {
      expect(decideTransfiTransition(s, 'asset_settled')).toBe('complete');
    }
    expect(decideTransfiTransition('COMPLETED', 'asset_settled')).toBe('ignore');
  });

  test('failures expire, intermediates keep', () => {
    expect(decideTransfiTransition('PAYMENT_PENDING', 'fund_deposit_failed')).toBe('expire');
    expect(decideTransfiTransition('PAYMENT_PENDING', 'expired')).toBe('expire');
    expect(decideTransfiTransition('CRYPTO_PROCESSING', 'asset_settle_failed')).toBe('expire');
    expect(decideTransfiTransition('COMPLETED', 'asset_settle_failed')).toBe('ignore');
    expect(decideTransfiTransition('PAYMENT_PENDING', 'initiated')).toBe('keep');
    expect(decideTransfiTransition('PAYMENT_PENDING', 'fund_processing')).toBe('keep');
    expect(decideTransfiTransition('PAYMENT_CONFIRMED', 'asset_processing')).toBe('keep');
  });
});

describe('onramp payload builder', () => {
  const base = {
    userId: 'UX-123',
    partnerId: 'krm_test123',
    purposeCode: 'company_expenses',
    sourceCurrency: 'IDR',
    sourceAmount: 100000,
    destinationCurrency: 'SOL',
    walletAddress: 'DC8RsUR6qyeveqb2rvHRYLwHFyRToha91G7qZz4cj7ib',
  };

  test('builds documented onramp shape with partnerId', () => {
    const p = buildOnrampPayload(base) as Record<string, unknown>;
    expect(p.orderType).toBe('onramp');
    expect(p.partnerId).toBe('krm_test123');
    expect(((p.destination as Record<string, unknown>).additionalPaymentDetails as Record<string, unknown>).walletOwner).toBe('self');
  });

  test('rejects bad userId/amount/wallet/partner', () => {
    expect(() => buildOnrampPayload({ ...base, userId: 'BAD' })).toThrow();
    expect(() => buildOnrampPayload({ ...base, partnerId: '' })).toThrow();
    expect(() => buildOnrampPayload({ ...base, sourceAmount: -5 })).toThrow();
    expect(() => buildOnrampPayload({ ...base, sourceAmount: 1.5 })).toThrow();
    expect(() => buildOnrampPayload({ ...base, walletAddress: '' })).toThrow();
  });
});

describe('config', () => {
  test('base URL allowlist enforced', () => {
    expect(normalizeTransfiBaseUrl('https://sandbox-api.transfi.com')).toBe('https://sandbox-api.transfi.com');
    expect(normalizeTransfiBaseUrl('https://api.transfi.com')).toBe('https://api.transfi.com');
    expect(() => normalizeTransfiBaseUrl('http://sandbox-api.transfi.com')).toThrow();
    expect(() => normalizeTransfiBaseUrl('https://evil.com')).toThrow();
    expect(() => normalizeTransfiBaseUrl('https://sandbox-api.transfi.com.evil.com')).toThrow();
  });

  test('missing credentials fail fast without values', () => {
    const OLD = { ...process.env };
    delete process.env.TRANSFI_USERNAME;
    delete process.env.TRANSFI_PASSWORD;
    delete process.env.TRANSFI_MID;
    expect(() => getTransfiConfig()).toThrow();
    process.env = OLD;
  });

  test('TransfiError carries category, never secret', () => {
    const e = new TransfiError('create_order', 'TRANSIENT', 500, 'OR-1');
    expect(e.message).not.toMatch(/password|secret|Basic/i);
    expect(e.category).toBe('TRANSIENT');
  });
});
