import Decimal from 'decimal.js';

jest.mock('@/lib/blockchain', () => ({
  getBlockchainProvider: () => ({
    isValidAddress: () => true,
    getBalance: async () => '1.0',
    getTransaction: async () => null,
  }),
}));

import { toBaseUnits, submitRewardTransaction, getPayoutAdapter, runPayoutDryRun, assertDryRunEnabled, getPayoutMode, fetchUsdRateFresh, getUsdRate } from './rewardPayout';

describe('rewardPayout decimal precision (no floats)', () => {
  test('$1.42 @ $150.25/SOL → exact lamports, floor', () => {
    const expected = new Decimal('1.42').div('150.25').mul(new Decimal(10).pow(9)).floor().toFixed(0);
    expect(toBaseUnits('1.42', new Decimal('150.25'), 9)).toBe(expected);
    // Float math would give 9450918.468...*1e9 imprecision; result must be integer string.
    expect(toBaseUnits('1.42', new Decimal('150.25'), 9)).toMatch(/^\d+$/);
  });

  test('classic 0.1+0.2 float trap: $0.30 @ $1 centers exact', () => {
    // (0.1+0.2) in float = 0.30000000000000004 — Decimal path stays exact.
    expect(toBaseUnits('0.3', new Decimal('1'), 18)).toBe('300000000000000000');
  });

  test('zero/negative reward rejected downstream (no throw here, integer output)', () => {
    expect(toBaseUnits('2.00', new Decimal('2'), 18)).toBe('1000000000000000000');
  });
});

describe('broadcast guard', () => {
  test('submitRewardTransaction always throws, never broadcasts', async () => {
    await expect(submitRewardTransaction()).rejects.toMatchObject({ code: 'PAYOUT_NOT_IMPLEMENTED' });
  });

  test('unknown network rejected', () => {
    expect(() => getPayoutAdapter('ETHEREUM')).toThrow();
  });
});

describe('dry-run (no broadcast)', () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    global.fetch = (async () =>
      ({ ok: true, json: async () => ({ solana: { usd: 150.25 } }) }) as Response) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  test('valid dry-run returns quote, never submits', async () => {
    const r = await runPayoutDryRun({
      network: 'SOLANA',
      destination: 'DC8RsUR6qyeveqb2rvHRYLwHFyRToha91G7qZz4cj7ib',
      rewardUsd: '1.42',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result.status).toBe('DRY_RUN');
    expect(r.result.transactionSubmitted).toBe(false);
    expect(r.result).not.toHaveProperty('txHash');
    expect(r.result.tokenAmount).toBe(new Decimal('1.42').div('150.25').toFixed(9));
    expect(r.result.baseUnits).toBe(toBaseUnits('1.42', new Decimal('150.25'), 9));
  });

  test('BNB is isolated to BSC provider, never Solana', () => {
    const bnb = getPayoutAdapter('BNB');
    expect(bnb.providerNetwork).toBe('BSC');
    expect(bnb.network).toBe('BNB');
    expect(getPayoutAdapter('SOLANA').providerNetwork).toBe('SOLANA');
  });

  test('safe default: payout disabled without explicit opt-in', () => {
    delete process.env.REWARD_PAYOUT_MODE;
    expect(getPayoutMode()).toBe('disabled');
    expect(() => assertDryRunEnabled()).toThrow();
  });

  test('no private key material referenced', () => {
    const fs = require('fs');
    const src: string = fs.readFileSync(__filename.replace(/\.test\.ts$/, '.ts'), 'utf8');
    expect(src).not.toMatch(/private[_-]?key/i);
    expect(src).not.toMatch(/mnemonic|seed[_-]?phrase/i);
  });

  test('live payout uses fresh rate, never cached (§8/§9)', async () => {
    let calls = 0;
    global.fetch = (async () => {
      calls++;
      return { ok: true, json: async () => ({ solana: { usd: 150 + calls } }) };
    }) as unknown as typeof fetch;
    const a = await getUsdRate('solana');
    const b = await getUsdRate('solana');
    expect(a?.toString()).toBe(b?.toString()); // cached path still caches
    const callsBefore = calls;
    const fresh = await fetchUsdRateFresh('solana');
    expect(calls).toBe(callsBefore + 1); // fresh path always refetches
    expect(fresh?.toString()).not.toBe(a?.toString());
  });

  test('rate provider failure → NO payout (§9)', async () => {
    global.fetch = (async () => ({ ok: false, status: 429 })) as unknown as typeof fetch;
    const r = await runPayoutDryRun({
      network: 'BASE',
      destination: '0xB2Ef369384C0b582DBd6880226705E8d37988Bdc',
      rewardUsd: '1.50',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.failure).toBe('RATE_UNAVAILABLE');
  });
});
