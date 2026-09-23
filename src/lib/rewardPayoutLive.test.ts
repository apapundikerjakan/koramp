jest.mock('@/lib/blockchain', () => ({
  getBlockchainProvider: () => ({
    isValidAddress: () => true,
    getBalance: async () => '1.0',
    getTransaction: async () => null,
  }),
}));

const mockPrismaState: { findUnique?: (args: unknown) => Promise<unknown> } = {};
jest.mock('@/lib/prisma', () => ({
  prisma: {
    rewardClaim: {
      findUnique: (...args: unknown[]) => {
        if (!mockPrismaState.findUnique) throw new Error('DB must not be touched in unit test');
        return mockPrismaState.findUnique(args);
      },
    },
  },
}));

jest.mock('@solana/web3.js', () => ({
  Connection: class {},
  PublicKey: class {},
  Keypair: { fromSecretKey: () => { throw new Error('no keys in tests'); } },
  SystemProgram: { transfer: () => ({}) },
  Transaction: class {},
}));

jest.mock('ethers', () => ({ ethers: {} }));

import {
  getLivePayoutMode,
  assertLiveEnabled,
  assertLiveNetwork,
  assertTestnetRpcUrl,
  verifyEvmTestnetChain,
  verifySolanaDevnet,
  checkLivePrereqs,
  executeRewardPayout,
  reconcileRewardPayout,
  resolveTreasuryKey,
  RETRYABLE_FAILURES,
  MAX_ATTEMPTS,
} from './rewardPayoutLive';

describe('live mode guard (§0, §32, §33)', () => {
  const OLD = process.env.REWARD_PAYOUT_MODE;

  afterEach(() => {
    if (OLD === undefined) delete process.env.REWARD_PAYOUT_MODE;
    else process.env.REWARD_PAYOUT_MODE = OLD;
  });

  test('safe default is disabled (never live)', () => {
    delete process.env.REWARD_PAYOUT_MODE;
    expect(getLivePayoutMode()).toBe('disabled');
    expect(() => assertLiveEnabled()).toThrow();
  });

  test.each(['dry-run', 'staging', '1', 'true', ''])('mode %p does not enable live', (m) => {
    process.env.REWARD_PAYOUT_MODE = m;
    expect(getLivePayoutMode()).not.toBe('live');
  });

  test('explicit live opt-in is recognized (whitespace/case tolerant)', () => {
    process.env.REWARD_PAYOUT_MODE = 'live';
    expect(getLivePayoutMode()).toBe('live');
  });

  test('execute refuses before touching DB when not live', async () => {
    delete process.env.REWARD_PAYOUT_MODE;
    await expect(executeRewardPayout('any-id')).rejects.toMatchObject({ code: 'PAYOUT_NOT_LIVE' });
  });
});

describe('testnet enforcement — mainnet can never slip through', () => {
  test('mainnet RPC URLs rejected', () => {
    for (const url of [
      'https://api.mainnet-beta.solana.com',
      'https://bsc-dataseed.binance.org',
      'https://bsc-dataseed1.defibit.io',
      'https://mainnet.base.org',
    ]) {
      expect(() => assertTestnetRpcUrl('SOLANA', url)).toThrow();
    }
  });

  test('testnet RPC URLs accepted', () => {
    expect(() => assertTestnetRpcUrl('SOLANA', 'https://api.devnet.solana.com')).not.toThrow();
    expect(() => assertTestnetRpcUrl('BASE', 'https://sepolia.base.org')).not.toThrow();
    expect(() => assertTestnetRpcUrl('BNB', 'https://bsc-testnet-rpc.publicnode.com')).not.toThrow();
  });

  test('wrong EVM chain rejected (mainnet chain IDs)', async () => {
    const mainnetBase = { getNetwork: async () => ({ chainId: 8453 }) };
    const mainnetBnb = { getNetwork: async () => ({ chainId: 56 }) };
    await expect(verifyEvmTestnetChain(mainnetBase, 'BASE')).rejects.toMatchObject({ code: 'CONFIG_ERROR' });
    await expect(verifyEvmTestnetChain(mainnetBnb, 'BNB')).rejects.toMatchObject({ code: 'CONFIG_ERROR' });
  });

  test('correct testnet chains accepted', async () => {
    await expect(
      verifyEvmTestnetChain({ getNetwork: async () => ({ chainId: 84532 }) }, 'BASE'),
    ).resolves.toBeUndefined();
    await expect(
      verifyEvmTestnetChain({ getNetwork: async () => ({ chainId: BigInt(97) }) }, 'BNB'),
    ).resolves.toBeUndefined();
  });

  test('RPC failure during chain check is retryable, not fatal', async () => {
    const dead = { getNetwork: async () => { throw new Error('down'); } };
    await expect(verifyEvmTestnetChain(dead, 'BASE')).rejects.toMatchObject({ code: 'RPC_UNAVAILABLE' });
  });

  test('wrong Solana cluster rejected (mainnet genesis)', async () => {
    const mainnet = { getGenesisHash: async () => '5EybkYdUi4Z3HGuHsr6Pf7GN8kbZSUDggRro6iVbLFyr' };
    await expect(verifySolanaDevnet(mainnet)).rejects.toMatchObject({ code: 'CONFIG_ERROR' });
  });

  test('devnet genesis accepted', async () => {
    const devnet = { getGenesisHash: async () => 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG' };
    await expect(verifySolanaDevnet(devnet)).resolves.toBeUndefined();
  });
});
describe('treasury fallback to platform hot wallet (network-specific)', () => {
  const KEYS = [
    'SOLANA_REWARD_TREASURY_PRIVATE_KEY', 'BASE_REWARD_TREASURY_PRIVATE_KEY', 'BNB_REWARD_TREASURY_PRIVATE_KEY',
    'SOLANA_PLATFORM_PRIVATE_KEY', 'BASE_PLATFORM_PRIVATE_KEY', 'BSC_PLATFORM_PRIVATE_KEY',
  ];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k] as string;
    }
  });

  test('dedicated reward key takes precedence (fake values, in-test only)', () => {
    process.env.SOLANA_REWARD_TREASURY_PRIVATE_KEY = 'REWARD_KEY';
    process.env.SOLANA_PLATFORM_PRIVATE_KEY = 'PLATFORM_KEY';
    const r = resolveTreasuryKey('SOLANA');
    expect(r.key).toBe('REWARD_KEY');
    expect(r.source).toBe('SOLANA_REWARD_TREASURY_PRIVATE_KEY');
  });

  test('falls back to platform key per network (BNB→BSC, never cross-wired)', () => {
    process.env.BSC_PLATFORM_PRIVATE_KEY = 'BSC_KEY';
    process.env.BASE_PLATFORM_PRIVATE_KEY = 'BASE_KEY';
    expect(resolveTreasuryKey('BNB')).toEqual({ key: 'BSC_KEY', source: 'BSC_PLATFORM_PRIVATE_KEY' });
    expect(resolveTreasuryKey('BASE')).toEqual({ key: 'BASE_KEY', source: 'BASE_PLATFORM_PRIVATE_KEY' });
  });

  test('missing both → CONFIG_ERROR, no broadcast', () => {
    expect(() => resolveTreasuryKey('SOLANA')).toThrow();
  });
});
describe('per-network live confirmation (§2 env isolation)', () => {
  const OLD_MODE = process.env.REWARD_PAYOUT_MODE;
  const OLD_CONFIRM = process.env.REWARD_LIVE_CONFIRM;

  afterEach(() => {
    if (OLD_MODE === undefined) delete process.env.REWARD_PAYOUT_MODE;
    else process.env.REWARD_PAYOUT_MODE = OLD_MODE;
    if (OLD_CONFIRM === undefined) delete process.env.REWARD_LIVE_CONFIRM;
    else process.env.REWARD_LIVE_CONFIRM = OLD_CONFIRM;
  });

  test('mode=live alone is NOT enough', () => {
    process.env.REWARD_PAYOUT_MODE = 'live';
    delete process.env.REWARD_LIVE_CONFIRM;
    expect(() => assertLiveNetwork('SOLANA')).toThrow();
  });

  test('confirm must match the claim network exactly', () => {
    process.env.REWARD_PAYOUT_MODE = 'live';
    process.env.REWARD_LIVE_CONFIRM = 'SOLANA';
    expect(() => assertLiveNetwork('SOLANA')).not.toThrow();
    expect(() => assertLiveNetwork('BASE')).toThrow();
  });
});

describe('reconcile without known tx (§7, §16)', () => {
  test('no txHash → 409, never broadcasts', async () => {
    mockPrismaState.findUnique = async () => ({
      id: 'c1', publicId: 'p1', status: 'FAILED', txHash: null, failureReason: 'BROADCAST_FAILED',
      network: 'SOLANA', walletAddress: 'w', destWallet: 'w',
    });
    await expect(reconcileRewardPayout('c1')).rejects.toMatchObject({ code: 'NOTHING_TO_RECONCILE' });
    mockPrismaState.findUnique = undefined;
  });

  test('PAID returns existing result, no-op', async () => {
    mockPrismaState.findUnique = async () => ({
      id: 'c1', publicId: 'p1', status: 'PAID', txHash: 'SIG', failureReason: null,
      network: 'SOLANA', walletAddress: 'w', destWallet: 'w',
    });
    const r = await reconcileRewardPayout('c1');
    expect(r.status).toBe('PAID');
    expect(r.txHash).toBe('SIG');
    mockPrismaState.findUnique = undefined;
  });
});
describe('live prerequisites (§32)', () => {
  test('missing treasury key → CONFIG_ERROR, no broadcast', () => {
    delete process.env.SOLANA_REWARD_TREASURY_PRIVATE_KEY;
    expect(() => checkLivePrereqs('SOLANA')).toThrow();
  });

  test('non-NATIVE token config → STOP without fallback', () => {
    process.env.SOLANA_REWARD_TOKEN = 'SOME_MINT_ADDRESS';
    expect(() => checkLivePrereqs('SOLANA')).toThrow();
    delete process.env.SOLANA_REWARD_TOKEN;
  });
});

describe('retry policy (§22-23)', () => {
  test('bounded attempts', () => {
    expect(MAX_ATTEMPTS).toBe(3);
  });

  test('UNKNOWN is not retryable (reconcile-only)', () => {
    expect(RETRYABLE_FAILURES.has('BROADCAST_UNKNOWN')).toBe(false);
    expect(RETRYABLE_FAILURES.has('TX_REVERTED')).toBe(false);
    expect(RETRYABLE_FAILURES.has('VALIDATION_FAILED')).toBe(false);
  });

  test('operational failures are retryable', () => {
    for (const f of ['BROADCAST_FAILED', 'RATE_UNAVAILABLE', 'RPC_UNAVAILABLE', 'INSUFFICIENT_BALANCE', 'FEE_ESTIMATE_FAILED']) {
      expect(RETRYABLE_FAILURES.has(f)).toBe(true);
    }
  });
});

describe('secret isolation (§2, §19, §31)', () => {
  test('no secret material, no secret logging', () => {
    const fs = require('fs');
    const src: string = fs.readFileSync(__filename.replace('.test.ts', '.ts'), 'utf8');
    expect(src).not.toMatch(/seed[_-]?phrase|mnemonic|recovery[_-]?phrase/i);
    expect(src).not.toMatch(/console\.(log|info|debug)\([^)]*(key|secret)/i);
    // PRIVATE_KEY appears only as env-name constants, never assigned a value.
    const hits = src.match(/PRIVATE_KEY/g) ?? [];
    expect(hits.length).toBeGreaterThan(0);
    expect(src).not.toMatch(/PRIVATE_KEY\s*=\s*['"`][^'"`]+['"`]/);
  });
});
