import { rateLimit, getRateLimiter, getRateLimitMode, getRateLimitRemaining } from './rateLimit';

const OLD_MODE = process.env.RATE_LIMIT_STORE;

afterEach(() => {
  if (OLD_MODE === undefined) delete process.env.RATE_LIMIT_STORE;
  else process.env.RATE_LIMIT_STORE = OLD_MODE;
});

describe('memory store (local dev)', () => {
  test('allows N then denies within window', async () => {
    delete process.env.RATE_LIMIT_STORE;
    const id = `qa-mem-${Date.now()}`;
    expect(await rateLimit(id, '10.1.1.1', 2, 60_000, { flood: false })).toBe(true);
    expect(await rateLimit(id, '10.1.1.1', 2, 60_000, { flood: false })).toBe(true);
    expect(await rateLimit(id, '10.1.1.1', 2, 60_000, { flood: false })).toBe(false);
  });

  test('independent buckets per identifier+ip', async () => {
    const id = `qa-iso-${Date.now()}`;
    expect(await rateLimit(id, '10.1.1.2', 1, 60_000, { flood: false })).toBe(true);
    expect(await rateLimit(id, '10.1.1.2', 1, 60_000, { flood: false })).toBe(false);
    expect(await rateLimit(id, '10.1.1.3', 1, 60_000, { flood: false })).toBe(true);
  });

  test('window expiry resets budget', async () => {
    const id = `qa-ttl-${Date.now()}`;
    expect(await rateLimit(id, '10.1.1.4', 1, 40, { flood: false })).toBe(true);
    expect(await rateLimit(id, '10.1.1.4', 1, 40, { flood: false })).toBe(false);
    await new Promise((r) => setTimeout(r, 60));
    expect(await rateLimit(id, '10.1.1.4', 1, 40, { flood: false })).toBe(true);
  });

  test('concurrent increments are counted exactly (abstraction level)', async () => {
    const id = `qa-conc-${Date.now()}`;
    const results = await Promise.all(
      Array.from({ length: 50 }, () => rateLimit(id, '10.1.1.5', 10, 60_000, { flood: false })),
    );
    expect(results.filter(Boolean).length).toBe(10);
    expect(await getRateLimitRemaining(id, '10.1.1.5', 10)).toBe(0);
  });
});

describe('distributed mode without backend (fail closed, no silent fallback)', () => {
  test('getRateLimitMode reads env, defaults memory', () => {
    delete process.env.RATE_LIMIT_STORE;
    expect(getRateLimitMode()).toBe('memory');
    process.env.RATE_LIMIT_STORE = 'distributed';
    expect(getRateLimitMode()).toBe('distributed');
  });

  test('rateLimit throws 503 instead of bypassing', async () => {
    process.env.RATE_LIMIT_STORE = 'distributed';
    await expect(rateLimit('qa-x', '10.2.2.2', 100, 60_000, { flood: false })).rejects.toMatchObject({
      statusCode: 503,
    });
  });

  test('remaining reads as exhausted when backend unavailable', async () => {
    process.env.RATE_LIMIT_STORE = 'distributed';
    expect(await getRateLimitRemaining('qa-x', '10.2.2.2', 100)).toBe(0);
  });

  test('memory works again after restoring env (no stuck state)', () => {
    delete process.env.RATE_LIMIT_STORE;
    expect(getRateLimiter().check(`qa-back-${Date.now()}`, 1, 60_000)).toBe(true);
  });
});
