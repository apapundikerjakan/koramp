/**
 * Reward payout engine — PHASE 3A: DRY-RUN ONLY.
 *
 * - No broadcast path exists. submitRewardTransaction() always throws.
 * - REWARD_PAYOUT_MODE: 'disabled' (default/safe) | 'dry-run'.
 *   Anything else (including 'live') is rejected — no production payout.
 * - All money math in Decimal → exact base-unit strings. No floats.
 * - Treasury config holds ADDRESSES only. No private keys anywhere.
 */

import Decimal from 'decimal.js';
import { getBlockchainProvider, type NetworkId } from '@/lib/blockchain';
import { AppError } from '@/lib/errors';

export type PayoutMode = 'disabled' | 'dry-run';

export function getPayoutMode(): PayoutMode {
  const m = (process.env.REWARD_PAYOUT_MODE ?? 'disabled').trim().toLowerCase();
  return m === 'dry-run' ? 'dry-run' : 'disabled';
}

/** Throws unless dry-run is explicitly enabled. Safe default: disabled. */
export function assertDryRunEnabled(): void {
  if (getPayoutMode() !== 'dry-run') {
    throw new AppError(503, 'PAYOUT_DISABLED', 'Reward payout is disabled. Dry-run only.');
  }
}

/**
 * Broadcast is NOT implemented in Phase 3A. This function exists so any
 * future/wrong call path fails closed instead of silently sending funds.
 */
export async function submitRewardTransaction(): Promise<never> {
  throw new AppError(503, 'PAYOUT_NOT_IMPLEMENTED', 'Broadcast is not implemented (dry-run phase).');
}

// ─── Network adapters ─────────────────────────────────────────────────────

export interface PayoutAdapter {
  network: 'SOLANA' | 'BNB' | 'BASE';
  providerNetwork: NetworkId;
  asset: 'SOL' | 'BNB' | 'ETH';
  decimals: number;
  geckoId: string;
  validateDestination(address: string): boolean;
}

const ADAPTERS: Record<string, PayoutAdapter> = {
  SOLANA: { network: 'SOLANA', providerNetwork: 'SOLANA', asset: 'SOL', decimals: 9, geckoId: 'solana', validateDestination: (a) => getBlockchainProvider('SOLANA').isValidAddress(a) },
  BNB: { network: 'BNB', providerNetwork: 'BSC', asset: 'BNB', decimals: 18, geckoId: 'binancecoin', validateDestination: (a) => getBlockchainProvider('BSC').isValidAddress(a) },
  BASE: { network: 'BASE', providerNetwork: 'BASE', asset: 'ETH', decimals: 18, geckoId: 'ethereum', validateDestination: (a) => getBlockchainProvider('BASE').isValidAddress(a) },
};

export function getPayoutAdapter(network: string): PayoutAdapter {
  const a = ADAPTERS[network.toUpperCase()];
  if (!a) throw new AppError(400, 'UNSUPPORTED_NETWORK', 'Network tidak didukung.');
  return a;
}

// ─── USD rate (display/quote only — no funds move) ─────────────────────────

const rateCache = new Map<string, { rate: Decimal; at: number }>();
const RATE_TTL_MS = 60_000;

/** USD price per 1 unit of asset via CoinGecko (trusted allowlisted host). */
export async function getUsdRate(geckoId: string): Promise<Decimal | null> {
  const cached = rateCache.get(geckoId);
  if (cached && Date.now() - cached.at < RATE_TTL_MS) return cached.rate;
  const fresh = await fetchUsdRateFresh(geckoId);
  if (fresh) rateCache.set(geckoId, { rate: fresh, at: Date.now() });
  return fresh;
}

/**
 * Fresh USD rate — bypasses cache entirely. REQUIRED for live payouts
 * (§8/§9): never settle on a potentially stale cached price.
 */
export async function fetchUsdRateFresh(geckoId: string): Promise<Decimal | null> {
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(geckoId)}&vs_currencies=usd&precision=4`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000), cache: 'no-store' },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, { usd?: number }>;
    const usd = data[geckoId]?.usd;
    if (!usd || usd <= 0) return null;
    return new Decimal(usd);
  } catch {
    return null;
  }
}

/**
 * Exact base-unit conversion. Pure Decimal — e.g. $1.42 @ $150.25/SOL →
 * floor(1.42/150.25 * 1e9) as integer string. Never floats.
 */
export function toBaseUnits(rewardUsd: string, rateUsd: Decimal, decimals: number): string {
  const units = new Decimal(rewardUsd).div(rateUsd).mul(new Decimal(10).pow(decimals));
  return units.floor().toFixed(0);
}

// ─── Treasury (addresses only — NEVER keys) ────────────────────────────────

export interface TreasuryInfo {
  configured: boolean;
  address: string | null;
  balance: string | null;
  sufficient: boolean | null;
}

const TREASURY_ENV: Record<string, string> = {
  SOLANA: 'SOLANA_REWARD_TREASURY_ADDRESS',
  BNB: 'BNB_REWARD_TREASURY_ADDRESS',
  BASE: 'BASE_REWARD_TREASURY_ADDRESS',
};

/** Best-effort native balance read. Failure → RPC_UNAVAILABLE (retryable). */
export async function checkTreasury(adapter: PayoutAdapter): Promise<TreasuryInfo> {
  const address = (process.env[TREASURY_ENV[adapter.network]] ?? '').trim() || null;
  if (!address) return { configured: false, address: null, balance: null, sufficient: null };
  try {
    const balance = await getBlockchainProvider(adapter.providerNetwork).getBalance(address);
    const ok = new Decimal(balance).gt(0);
    return { configured: true, address, balance, sufficient: ok };
  } catch {
    return { configured: true, address, balance: null, sufficient: null };
  }
}

// ─── Dry-run ───────────────────────────────────────────────────────────────

export type DryRunFailure =
  | 'VALIDATION_FAILED'
  | 'RATE_UNAVAILABLE'
  | 'RPC_UNAVAILABLE'
  | 'INSUFFICIENT_BALANCE';

export interface DryRunResult {
  status: 'DRY_RUN';
  network: string;
  destination: string;
  rewardUsd: string;
  tokenAmount: string;
  baseUnits: string;
  rateUsd: string;
  rateSource: string;
  treasury: TreasuryInfo;
  transactionSubmitted: false;
}

export async function runPayoutDryRun(args: {
  network: string;
  destination: string;
  rewardUsd: string;
}): Promise<{ ok: true; result: DryRunResult } | { ok: false; failure: DryRunFailure; detail: string }> {
  const adapter = getPayoutAdapter(args.network);
  if (!adapter.validateDestination(args.destination)) {
    return { ok: false, failure: 'VALIDATION_FAILED', detail: 'Invalid destination address.' };
  }
  let rewardUsd: Decimal;
  try {
    rewardUsd = new Decimal(args.rewardUsd);
    if (!rewardUsd.gt(0)) throw new Error('non-positive');
  } catch {
    return { ok: false, failure: 'VALIDATION_FAILED', detail: 'Invalid reward amount.' };
  }
  const rate = await getUsdRate(adapter.geckoId);
  if (!rate) return { ok: false, failure: 'RATE_UNAVAILABLE', detail: 'Rate unavailable — retry later.' };
  const treasury = await checkTreasury(adapter);
  if (treasury.configured && treasury.balance === null) {
    return { ok: false, failure: 'RPC_UNAVAILABLE', detail: 'Treasury RPC unavailable — retry later.' };
  }
  if (treasury.sufficient === false) {
    return { ok: false, failure: 'INSUFFICIENT_BALANCE', detail: 'Treasury balance insufficient.' };
  }
  const tokenAmount = rewardUsd.div(rate).toFixed(adapter.decimals);
  return {
    ok: true,
    result: {
      status: 'DRY_RUN',
      network: adapter.network,
      destination: args.destination,
      rewardUsd: rewardUsd.toFixed(2),
      tokenAmount,
      baseUnits: toBaseUnits(rewardUsd.toFixed(2), rate, adapter.decimals),
      rateUsd: rate.toString(),
      rateSource: `coingecko:${adapter.geckoId}/usd`,
      treasury,
      transactionSubmitted: false,
    },
  };
}
