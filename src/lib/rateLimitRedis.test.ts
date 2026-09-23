/**
 * RedisRateLimitBackend tests.
 * - Unit (FakeRedis): deterministic, no server needed.
 * - Integration: REAL Redis only (RATE_LIMIT_REDIS_URL or 127.0.0.1:6379).
 *   Skipped with a clear warning when unreachable — never faked.
 */
import { RedisRateLimitBackend, rateLimitKey, type RedisCommands } from './rateLimitRedis';

/** Minimal in-process fake mimicking Redis INCR+PEXPIRE/GET/DEL semantics. */
class FakeRedis implements RedisCommands {
  private data = new Map<string, { count: number; expiresAt: number }>();
  failNext = 0;

  private maybeFail(op: string): void {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error(`fake redis down (${op})`);
    }
  }

  async eval(_script: string, _numkeys: number, ...args: Array<string | number>): Promise<unknown> {
    this.maybeFail('eval');
    const [key, windowMs] = args as [string, number];
    const now = Date.now();
    const cur = this.data.get(key);
    if (!cur || cur.expiresAt <= now) {
      this.data.set(key, { count: 1, expiresAt: now + Number(windowMs) });
      return 1;
    }
    cur.count++;
    return cur.count;
  }

  async get(key: string): Promise<string | null> {
    this.maybeFail('get');
    const cur = this.data.get(key);
    if (!cur || cur.expiresAt <= Date.now()) return null;
    return String(cur.count);
  }

  async del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) if (this.data.delete(k)) n++;
    return n;
  }

  async quit(): Promise<unknown> {
    return 'OK';
  }
}

describe('RedisRateLimitBackend (fake transport)', () => {
  test('key format hashes identifiers (no wallet/IP plaintext)', () => {
    const k = rateLimitKey('support-read:0xB2Ef369384C0b582DBd6880226705E8d37988Bdc');
    expect(k.startsWith('kipramp:rl:')).toBe(true);
    expect(k).not.toContain('0xB2Ef');
    expect(k).toHaveLength('kipramp:rl:'.length + 64);
  });

  test('threshold + TTL + reset semantics', async () => {
    const b = new RedisRateLimitBackend(new FakeRedis());
    const k = `qa-redis-${Date.now()}`;
    expect(await b.checkAsync(k, 2, 120)).toBe(true);
    expect(await b.checkAsync(k, 2, 120)).toBe(true);
    expect(await b.checkAsync(k, 2, 120)).toBe(false);
    expect(await b.getRemainingAsync(k, 2)).toBe(0);
    await new Promise((r) => setTimeout(r, 140));
    expect(await b.checkAsync(k, 2, 120)).toBe(true);
    expect(await b.getRemainingAsync(k, 2)).toBe(1);
  });

  test('concurrent increments are atomic at adapter level', async () => {
    const b = new RedisRateLimitBackend(new FakeRedis());
    const k = `qa-rconc-${Date.now()}`;
    const results = await Promise.all(Array.from({ length: 30 }, () => b.checkAsync(k, 5, 60_000)));
    expect(results.filter(Boolean).length).toBe(5);
  });

  test('transport failure propagates (caller fails closed)', async () => {
    const fake = new FakeRedis();
    fake.failNext = 99;
    const b = new RedisRateLimitBackend(fake);
    await expect(b.checkAsync(`qa-rfail-${Date.now()}`, 5, 60_000)).rejects.toThrow();
  });

  test('recovery: backend resumes after transient failure', async () => {
    const fake = new FakeRedis();
    const b = new RedisRateLimitBackend(fake);
    const k = `qa-rrec-${Date.now()}`;
    fake.failNext = 1;
    await expect(b.checkAsync(k, 5, 60_000)).rejects.toThrow();
    expect(await b.checkAsync(k, 5, 60_000)).toBe(true);
  });

  test('sync check/getRemaining refuse (never guess over network)', () => {
    const b = new RedisRateLimitBackend(new FakeRedis());
    expect(() => b.check('k', 1, 1000)).toThrow();
    expect(() => b.getRemaining('k', 1)).toThrow();
  });
});

describe('Redis integration (REAL server only)', () => {
  const URL = process.env.RATE_LIMIT_REDIS_URL ?? 'redis://127.0.0.1:6379';
  let available = false;
  let backend: RedisRateLimitBackend | null = null;
  let ns = '';

  beforeAll(async () => {
    try {
      const { createRedisRateLimitBackend } = await import('./rateLimitRedis');
      backend = await createRedisRateLimitBackend(URL);
      ns = `test:${Date.now()}:`;
      available = true;
    } catch {
      // eslint-disable-next-line no-console
      console.warn('Redis integration unavailable (no server) — skipping live tests, NOT passing.');
      available = false;
    }
  }, 15000);

  afterAll(async () => {
    if (backend) {
      const b = backend as unknown as { redis: { quit(): Promise<unknown> } };
      await b['redis'].quit().catch(() => {});
    }
  });

  const itRedis = (...args: [string, () => Promise<void>]) =>
    available ? it(...args) : it.skip(...args);

  itRedis('connect + threshold + TTL reset on isolated namespace', async () => {
    const k = `${ns}thr`;
    for (let i = 0; i < 3; i++) expect(await backend!.checkAsync(k, 3, 2000)).toBe(true);
    expect(await backend!.checkAsync(k, 3, 2000)).toBe(false);
    expect(await backend!.getRemainingAsync(k, 3)).toBe(0);
  });

  itRedis('concurrent increments allow exactly max', async () => {
    const k = `${ns}conc`;
    const results = await Promise.all(Array.from({ length: 40 }, () => backend!.checkAsync(k, 8, 10000)));
    expect(results.filter(Boolean).length).toBe(8);
  });

  itRedis('cleanup test keys', async () => {
    const b = backend as unknown as { redis: { del(...k: string[]): Promise<number> } };
    const { rateLimitKey: keyOf } = await import('./rateLimitRedis');
    await b.redis.del(keyOf(`${ns}thr`), keyOf(`${ns}conc`));
  });
});
