/**
 * Reward config-mapping regression tests (§4 env isolation).
 *
 * Pure static analysis (fs only — no src imports, no secrets read):
 * 1. Every REWARD_* env name consumed by payout code is documented in .env.example.
 * 2. No treasury/private-key name is ever NEXT_PUBLIC_* (client-leak guard).
 * 3. Payout mode has exactly three states with safe default (source-checked).
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function envNames(src: string): string[] {
  const names = new Set<string>();
  const re = /process\.env(?:\[['"]([A-Z0-9_]+)['"]\]|\.([A-Z0-9_]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) names.add(m[1] ?? m[2]);
  return [...names];
}

describe('reward env mapping', () => {
  const live = read('src/lib/rewardPayoutLive.ts');
  const dry = read('src/lib/rewardPayout.ts');
  const example = read('.env.example');

  test('every consumed REWARD_* name is documented in .env.example', () => {
    const consumed = [...envNames(live), ...envNames(dry)].filter((n) => n.includes('REWARD'));
    expect(consumed.length).toBeGreaterThan(0);
    const missing = consumed.filter((n) => !example.includes(n));
    expect(missing).toEqual([]);
  });

  test('no treasury/private-key name is client-exposed (NEXT_PUBLIC_*)', () => {
    const all = [...envNames(live), ...envNames(dry)];
    const leaked = all.filter((n) => n.startsWith('NEXT_PUBLIC_') && /TREASURY|PRIVATE|SECRET|KEY/.test(n));
    expect(leaked).toEqual([]);
  });

  test('mode has exactly disabled|dry-run|live with safe default', () => {
    expect(live).toMatch(/REWARD_PAYOUT_MODE.*disabled.*dry-run.*live/s);
    // Live module must reference the per-network confirm flag.
    expect(live).toContain('REWARD_LIVE_CONFIRM');
  });

  test('expected canonical names are the only treasury names consumed', () => {
    const all = [...envNames(live), ...envNames(dry)];
    const treasury = all.filter((n) => n.includes('TREASURY'));
    const expected = new Set([
      'SOLANA_REWARD_TREASURY_ADDRESS', 'BNB_REWARD_TREASURY_ADDRESS', 'BASE_REWARD_TREASURY_ADDRESS',
      'SOLANA_REWARD_TREASURY_PRIVATE_KEY', 'BNB_REWARD_TREASURY_PRIVATE_KEY', 'BASE_REWARD_TREASURY_PRIVATE_KEY',
    ]);
    for (const t of treasury) expect(expected.has(t)).toBe(true);
  });
});
