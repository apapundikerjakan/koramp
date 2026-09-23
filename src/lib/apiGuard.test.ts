import { readJsonBounded, guardPublic, guardCron } from './apiGuard';

function req(body: string): Request {
  return new Request('http://localhost/api/test', { method: 'POST', body });
}

describe('readJsonBounded', () => {
  test('malformed JSON → 400 INVALID_JSON (not 500)', async () => {
    await expect(readJsonBounded(req('{broken'))).rejects.toMatchObject({ statusCode: 400 });
  });

  test('valid JSON passes through', async () => {
    await expect(readJsonBounded(req('{"a":1}'))).resolves.toEqual({ a: 1 });
  });
});

describe('guardCron', () => {
  const OLD_SECRET = process.env.CRON_SECRET;
  const OLD_NODE_ENV = process.env.NODE_ENV;
  const setNodeEnv = (v: string | undefined) => {
    const env = process.env as Record<string, string | undefined>;
    if (v === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = v;
  };

  afterEach(() => {
    if (OLD_SECRET === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = OLD_SECRET;
    setNodeEnv(OLD_NODE_ENV);
  });

  const cronReq = (auth?: string) =>
    new Request('http://localhost/api/cron/x', auth ? { headers: { authorization: auth } } : {}) as never;

  test('missing secret in non-prod: open (dev convenience)', () => {
    delete process.env.CRON_SECRET;
    setNodeEnv('test');
    expect(guardCron(cronReq())).toBeNull();
  });

  test('missing secret in production: fail-closed 401', () => {
    delete process.env.CRON_SECRET;
    setNodeEnv('production');
    expect(guardCron(cronReq())?.status).toBe(401);
  });

  test('invalid credential: 401 (constant-time compare)', () => {
    process.env.CRON_SECRET = 's3cret-dev-only';
    expect(guardCron(cronReq('Bearer wrong'))?.status).toBe(401);
    expect(guardCron(cronReq('Bearer s3cret-dev-onl'))?.status).toBe(401);
  });

  test('valid credential: allowed', () => {
    process.env.CRON_SECRET = 's3cret-dev-only';
    expect(guardCron(cronReq('Bearer s3cret-dev-only'))).toBeNull();
  });
});
describe('guardPublic', () => {
  test('trips 429 after bucket exhausted', async () => {
    // Same IP → same bucket (key = bucket:ip).
    const r = () =>
      new Request('http://localhost/api/test', { headers: { 'x-forwarded-for': '10.9.8.7' } });
    expect((await guardPublic(r() as never, 'qa-test-bucket-1', 2)).response).toBeNull();
    expect((await guardPublic(r() as never, 'qa-test-bucket-1', 2)).response).toBeNull();
    const blocked = await guardPublic(r() as never, 'qa-test-bucket-1', 2);
    expect(blocked.response?.status).toBe(429);
  });
});
