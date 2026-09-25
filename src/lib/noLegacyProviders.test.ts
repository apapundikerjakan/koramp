/**
 * Provider exclusivity regression tests — Xendit is the ONLY active
 * payment/payout gateway. Obsolete providers (KiPay, TransFi, FYAS)
 * must have no executable path, no route, no config, and no selectable
 * provider literal in the order engine.
 *
 * Hermetic: filesystem assertions only, no network, no DB, no secrets.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..', '..');
const p = (...segs: string[]) => path.join(ROOT, ...segs);
const read = (file: string) => fs.readFileSync(p(file), 'utf8');

describe('obsolete provider modules are gone', () => {
  it.each(['./transfi', './fyas'])('src/lib/%s is not resolvable', (mod) => {
    expect(() => require.resolve(mod, { paths: [path.join(ROOT, 'src', 'lib')] })).toThrow();
  });
  it('no legacy provider test files remain', () => {
    for (const f of ['src/lib/transfi.test.ts']) {
      expect(fs.existsSync(p(f))).toBe(false);
    }
  });
});

describe('obsolete provider routes are gone; xendit routes remain', () => {
  it.each([
    'src/app/api/webhooks/transfi',
    'src/app/api/webhooks/kipay',
    'src/app/api/payments/simulate',
    'src/app/api/admin/health/transfi',
    'src/app/api/admin/health/kipay',
    'src/app/api/admin/health/fyas',
  ])('%s does not exist', (dir) => {
    expect(fs.existsSync(p(dir))).toBe(false);
  });
  it.each([
    'src/app/api/webhooks/xendit/payment/route.ts',
    'src/app/api/webhooks/xendit/payout/route.ts',
    'src/app/api/admin/health/xendit/route.ts',
  ])('%s exists', (file) => {
    expect(fs.existsSync(p(file))).toBe(true);
  });
});

describe('order engine cannot select an obsolete provider', () => {
  const ordersSrc = read('src/lib/orders.ts');
  it.each([`'transfi'`, `'fyas'`, `'kipay'`, `"transfi"`, `"fyas"`, `"kipay"`])(
    'contains no %s provider literal',
    (lit) => {
      expect(ordersSrc.includes(lit)).toBe(false);
    },
  );
  it("writes provider 'xendit' for new payments and payouts", () => {
    expect(ordersSrc.includes(`provider: 'xendit'`)).toBe(true);
  });
  it('imports the xendit client and no legacy provider client', () => {
    expect(ordersSrc.includes(`from './xendit'`)).toBe(true);
    expect(ordersSrc.includes(`from './transfi'`)).toBe(false);
    expect(ordersSrc.includes(`from './fyas'`)).toBe(false);
  });
});

describe('no obsolete gateway env vars in config', () => {
  it.each(['.env.example', 'vercel.json'])('%s has no TRANSFI_/FYAS_/KIPAY_/MOCK_ vars', (file) => {
    const content = read(file);
    for (const token of ['TRANSFI_', 'FYAS_', 'KIPAY_', 'MOCK_WEBHOOK_SECRET', 'kipay', 'transfi', 'fyas']) {
      // .env.example keeps one intentional doc line naming the removed prefixes.
      if (file === '.env.example' && content.split('\n').filter((l) => l.includes(token)).every((l) => l.trim().startsWith('#'))) {
        const nonComment = content.split('\n').filter((l) => !l.trim().startsWith('#') && l.includes(token));
        expect(nonComment).toEqual([]);
        continue;
      }
      expect(content.includes(token)).toBe(false);
    }
  });
  it('vercel.json keeps the xendit + cron configuration', () => {
    const v = JSON.parse(read('vercel.json'));
    expect(v.env.XENDIT_API_KEY).toBeDefined();
    expect(v.env.XENDIT_WEBHOOK_TOKEN).toBeDefined();
    expect(v.env.XENDIT_MODE).toBeDefined();
    expect(JSON.stringify(v.crons)).toContain('reconcile');
  });
});

describe('no obsolete provider logo assets', () => {
  it('public/logos contains no kipay/transfi/fyas asset', () => {
    const files = fs.readdirSync(p('public', 'logos'));
    for (const f of files) {
      expect(f.toLowerCase()).not.toMatch(/kipay|transfi|fyas/);
    }
  });
});
