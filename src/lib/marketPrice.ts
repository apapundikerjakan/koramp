/**
 * Live market price fetcher — CoinGecko public API
 *
 * Endpoint: GET https://api.coingecko.com/api/v3/simple/price
 * No API key required (keyless public API, ~30 calls/min limit).
 *
 * Cache strategy:
 *  - In-memory cache with 60s TTL (per-process, resets on cold start)
 *  - Single-flight: concurrent requests share one CoinGecko fetch
 *  - On fetch failure: admin manual price → stale cache (max 5 min) → throw
 *  - Hardcoded fallback ONLY if MARKETPLACE_EMERGENCY_HARDCODED_PRICE=true
 *
 * NEVER use floating point for financial math — all values returned as Decimal strings.
 */

import Decimal from 'decimal.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AssetSymbol = 'SOL' | 'ETH' | 'BNB';

interface CacheEntry {
  priceIdr: Decimal;
  fetchedAt: number; // Date.now()
}

// ─── Config ───────────────────────────────────────────────────────────────────

const COINGECKO_URL = 'https://api.coingecko.com/api/v3/simple/price';

const COINGECKO_IDS: Record<AssetSymbol, string> = {
  SOL: 'solana',
  ETH: 'ethereum',
  BNB: 'binancecoin',
};

// Conservative fallback prices (IDR) — only used if CoinGecko and DB both fail
const FALLBACK_PRICES: Record<AssetSymbol, number> = {
  SOL: 2_800_000,
  ETH: 60_000_000,
  BNB: 10_000_000,
};

const CACHE_TTL_MS = 60_000; // 60 seconds

// ─── In-memory cache ──────────────────────────────────────────────────────────
// Module-level — shared across requests within the same Next.js process

const priceCache = new Map<AssetSymbol, CacheEntry>();

// Single-flight: concurrent callers share one CoinGecko request (P8).
let inFlightFetch: Promise<Partial<Record<AssetSymbol, Decimal>>> | null = null;

// Max age for stale cache fallback. Beyond this, quotes must stop
// rather than use indefinitely stale prices (financial safety).
const MAX_STALE_MS = 5 * 60 * 1000; // 5 minutes

function allowHardcodedFallback(): boolean {
  return process.env.MARKETPLACE_EMERGENCY_HARDCODED_PRICE === 'true';
}

async function fetchSingleFlight(): Promise<Partial<Record<AssetSymbol, Decimal>>> {
  if (inFlightFetch) return inFlightFetch;
  inFlightFetch = fetchFromCoinGecko().finally(() => {
    inFlightFetch = null;
  });
  return inFlightFetch;
}

async function getManualPrice(
  asset: AssetSymbol,
  prisma?: { systemSetting: { findUnique(args: { where: { key: string } }): Promise<{ value: string } | null> } },
): Promise<Decimal | null> {
  if (!prisma) return null;
  try {
    const key = `price_${asset.toLowerCase()}_idr`;
    const setting = await prisma.systemSetting.findUnique({ where: { key } });
    if (setting?.value) {
      const p = new Decimal(setting.value);
      if (p.gt(0)) return p;
    }
  } catch (err) {
    console.warn(`[marketPrice] DB manual price lookup failed for ${asset}: ${err instanceof Error ? err.message : err}`);
  }
  return null;
}

// ─── Fetcher ──────────────────────────────────────────────────────────────────

/**
 * Fetch all three asset prices from CoinGecko in one request.
 * Returns a map of asset → IDR price as Decimal.
 */
async function fetchFromCoinGecko(): Promise<Partial<Record<AssetSymbol, Decimal>>> {
  const ids = Object.values(COINGECKO_IDS).join(',');
  const url = `${COINGECKO_URL}?ids=${ids}&vs_currencies=idr&precision=2`;

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(5000), // 5s timeout
    cache: 'no-store',
  });

  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);

  const data = await res.json() as Record<string, { idr?: number }>;

  const result: Partial<Record<AssetSymbol, Decimal>> = {};
  for (const [asset, geckoId] of Object.entries(COINGECKO_IDS) as [AssetSymbol, string][]) {
    const price = data[geckoId]?.idr;
    if (price && price > 0) {
      result[asset] = new Decimal(price);
    }
  }
  return result;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Get the current IDR price for a single asset.
 *
 * Priority (financial safety):
 *  1. In-memory cache (if < 60s old)
 *  2. Fresh CoinGecko fetch via single-flight (updates cache for all assets)
 *  3. Admin manual price (DB SystemSetting price_*_idr)
 *  4. Stale cache ONLY within MAX_STALE_MS (5 min)
 *  5. STOP — throw instead of hardcoded/stale price, unless emergency mode
 *     explicitly enabled via MARKETPLACE_EMERGENCY_HARDCODED_PRICE=true
 *
 * @param asset Asset symbol
 * @param prisma  Prisma client (for DB fallback) — optional
 */
export async function getLivePrice(
  asset: AssetSymbol,
  prisma?: { systemSetting: { findUnique(args: { where: { key: string } }): Promise<{ value: string } | null> } },
): Promise<Decimal> {
  const now = Date.now();
  const cached = priceCache.get(asset);

  // 1. Fresh cache hit
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.priceIdr;
  }

  // 2. Try live fetch via single-flight (concurrent callers share one request)
  try {
    const prices = await fetchSingleFlight();
    const fetchedAt = Date.now();

    for (const [sym, price] of Object.entries(prices) as [AssetSymbol, Decimal][]) {
      priceCache.set(sym, { priceIdr: price, fetchedAt });
    }

    const fresh = priceCache.get(asset);
    if (fresh) return fresh.priceIdr;
  } catch (err) {
    console.warn(`[marketPrice] CoinGecko fetch failed: ${err instanceof Error ? err.message : err}`);
  }

  // 3. Admin manual price (preferred over stale cache)
  const manual = await getManualPrice(asset, prisma);
  if (manual) {
    priceCache.set(asset, { priceIdr: manual, fetchedAt: now });
    return manual;
  }

  // 4. Stale cache within strict max age
  if (cached) {
    const ageMs = now - cached.fetchedAt;
    if (ageMs <= MAX_STALE_MS) {
      const staleAgeS = Math.round(ageMs / 1000);
      console.warn(`[marketPrice] Using stale price for ${asset} (${staleAgeS}s old, max ${MAX_STALE_MS / 1000}s)`);
      return cached.priceIdr;
    }
    console.error(`[marketPrice] Stale price for ${asset} too old (${Math.round(ageMs / 1000)}s) — refusing`);
  }

  // 5. Emergency hardcoded fallback only if explicitly enabled
  if (allowHardcodedFallback()) {
    console.warn(`[marketPrice] Using EMERGENCY hardcoded fallback for ${asset}`);
    return new Decimal(FALLBACK_PRICES[asset]);
  }

  // STOP creating new quotes rather than using unsafe price.
  throw new Error(
    `Market price unavailable for ${asset} (live failed, no manual price, stale too old). Stop creating quotes.`,
  );
}

/**
 * Get prices for all three assets at once (efficient — single CoinGecko call).
 * Returns { SOL, ETH, BNB } as Decimal IDR prices.
 */
export async function getAllLivePrices(
  prisma?: Parameters<typeof getLivePrice>[1],
): Promise<Record<AssetSymbol, Decimal>> {
  const [sol, eth, bnb] = await Promise.all([
    getLivePrice('SOL', prisma),
    getLivePrice('ETH', prisma),
    getLivePrice('BNB', prisma),
  ]);
  return { SOL: sol, ETH: eth, BNB: bnb };
}

/**
 * Force-refresh all prices from CoinGecko, bypassing cache.
 * Called by admin price-refresh endpoint.
 */
export async function refreshAllPrices(): Promise<Record<AssetSymbol, string>> {
  const prices = await fetchFromCoinGecko();
  const fetchedAt = Date.now();

  const result = {} as Record<AssetSymbol, string>;
  for (const asset of ['SOL', 'ETH', 'BNB'] as AssetSymbol[]) {
    const price = prices[asset];
    if (price) {
      priceCache.set(asset, { priceIdr: price, fetchedAt });
      result[asset] = price.toFixed(2);
    } else {
      const existing = priceCache.get(asset);
      result[asset] = existing?.priceIdr.toFixed(2) ?? String(FALLBACK_PRICES[asset]);
    }
  }
  return result;
}

/**
 * Get current cache state for display in admin dashboard.
 */
export function getPriceCacheStatus(): Record<AssetSymbol, { price: string; ageSeconds: number; source: string }> {
  const now = Date.now();
  const assets: AssetSymbol[] = ['SOL', 'ETH', 'BNB'];
  const result = {} as Record<AssetSymbol, { price: string; ageSeconds: number; source: string }>;

  for (const asset of assets) {
    const cached = priceCache.get(asset);
    if (cached) {
      const ageSeconds = Math.round((now - cached.fetchedAt) / 1000);
      result[asset] = {
        price: cached.priceIdr.toFixed(2),
        ageSeconds,
        source: ageSeconds < CACHE_TTL_MS / 1000 ? 'live' : 'stale',
      };
    } else {
      result[asset] = {
        price: String(FALLBACK_PRICES[asset]),
        ageSeconds: -1,
        source: 'fallback',
      };
    }
  }
  return result;
}
