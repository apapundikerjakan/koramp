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

// Negative backoff: when CoinGecko fails (e.g. HTTP 429), stop hitting it
// for a while instead of retrying on every request (which deepens the
// rate-limit and floods logs). Fallback chain below (manual → stale) is
// unchanged, so financial safety is preserved.
let cgBackoffUntil = 0;
const CG_BACKOFF_MS = 45_000; // 45 seconds
let cgFailLoggedUntil = 0;
const CG_FAIL_LOG_COOLDOWN_MS = 5 * 60 * 1000; // log failures at most every 5 min

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

// ─── Binance spot (same venue as the TradingView chart) ────────────────────
// Display-only indicative price. The chart renders BINANCE:XXXIDR spot, so
// the "current rate" label must come from the same venue or a structural
// ~1% gap appears (CoinGecko aggregates across exchanges + USD conversion).
// NEVER feed quotes from here: api.binance.com is geo-blocked (451) in some
// regions, so this is best-effort with graceful null — callers fall back to
// the CoinGecko pipeline. No cache beyond a short TTL; stale spot is still
// returned for display (better slightly old than empty).

const BINANCE_URL = 'https://api.binance.com/api/v3/ticker/price';

const BINANCE_SYMBOLS: Record<AssetSymbol, string> = {
  SOL: 'SOLIDR',
  ETH: 'ETHIDR',
  BNB: 'BNBIDR',
};

const SPOT_TTL_MS = 15_000; // 15 seconds — display freshness, not quote math

const spotCache = new Map<AssetSymbol, CacheEntry>();
let inFlightSpot: Promise<Partial<Record<AssetSymbol, Decimal>>> | null = null;

// Circuit breaker: api.binance.com diblokir di sebagian jaringan/region
// (HTTP 451 / DNS / timeout). Tanpa ini, tiap /api/prices menunggu timeout
// dan membanjiri log. Setelah 3 gagal beruntun, berhenti mencoba selama
// 5 menit dan diam-diam pakai CoinGecko — hanya log saat transisi.
let spotFails = 0;
let spotBreakerUntil = 0;
const SPOT_FAIL_THRESHOLD = 3;
const SPOT_BREAKER_MS = 5 * 60 * 1000;

function spotAllowed(): boolean {
  return Date.now() >= spotBreakerUntil;
}

async function fetchFromBinance(): Promise<Partial<Record<AssetSymbol, Decimal>>> {
  const symbols = encodeURIComponent(JSON.stringify(Object.values(BINANCE_SYMBOLS)));
  const res = await fetch(`${BINANCE_URL}?symbols=${symbols}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(3000), // display-only: gagal cepat, jangan tahan response
    cache: 'no-store',
  });

  if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);

  const data = (await res.json()) as Array<{ symbol?: string; price?: string }>;
  const bySymbol = new Map((Array.isArray(data) ? data : []).map((d) => [d.symbol, d.price]));

  const result: Partial<Record<AssetSymbol, Decimal>> = {};
  for (const [asset, sym] of Object.entries(BINANCE_SYMBOLS) as [AssetSymbol, string][]) {
    const raw = bySymbol.get(sym);
    if (raw && Number(raw) > 0) result[asset] = new Decimal(raw);
  }
  if (Object.keys(result).length === 0) throw new Error('Binance returned no usable prices');
  return result;
}

/**
 * Best-effort Binance spot price for DISPLAY only (same venue as chart).
 * Returns null when Binance fails — caller must fall back to CoinGecko.
 * Stale cache is acceptable here (indicative label, never quote math).
 */
export async function getSpotPrice(asset: AssetSymbol): Promise<Decimal | null> {
  const now = Date.now();
  const cached = spotCache.get(asset);
  if (cached && now - cached.fetchedAt < SPOT_TTL_MS) return cached.priceIdr;

  // Breaker terbuka → jangan sentuh jaringan sama sekali (hening total).
  if (!spotAllowed()) return cached?.priceIdr ?? null;

  try {
    if (!inFlightSpot) {
      inFlightSpot = fetchFromBinance().finally(() => {
        inFlightSpot = null;
      });
    }
    const prices = await inFlightSpot;
    const fetchedAt = Date.now();
    for (const [sym, price] of Object.entries(prices) as [AssetSymbol, Decimal][]) {
      spotCache.set(sym, { priceIdr: price, fetchedAt });
    }
    if (spotFails > 0) {
      spotFails = 0;
      console.warn('[marketPrice] Binance spot recovered — breaker closed');
    }
    return spotCache.get(asset)?.priceIdr ?? null;
  } catch (err) {
    spotFails++;
    // Log hanya pada kegagalan pertama dan saat breaker dibuka — bukan tiap request.
    if (spotFails === 1) {
      console.warn(`[marketPrice] Binance spot fetch failed: ${err instanceof Error ? err.message : err} — display falls back to CoinGecko`);
    } else if (spotFails === SPOT_FAIL_THRESHOLD) {
      spotBreakerUntil = Date.now() + SPOT_BREAKER_MS;
      console.warn(`[marketPrice] Binance spot breaker OPEN for ${SPOT_BREAKER_MS / 60000} min after ${spotFails} failures (likely geo-blocked)`);
    }
    return cached?.priceIdr ?? null;
  }
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

  // 2. Try live fetch via single-flight (concurrent callers share one request).
  // Skipped while negative backoff is active (upstream just failed).
  const inBackoff = Date.now() < cgBackoffUntil;
  if (!inBackoff) {
    try {
      const prices = await fetchSingleFlight();
      const fetchedAt = Date.now();

      for (const [sym, price] of Object.entries(prices) as [AssetSymbol, Decimal][]) {
        priceCache.set(sym, { priceIdr: price, fetchedAt });
      }

      const fresh = priceCache.get(asset);
      if (fresh) return fresh.priceIdr;
    } catch (err) {
      cgBackoffUntil = Date.now() + CG_BACKOFF_MS;
      if (Date.now() >= cgFailLoggedUntil) {
        cgFailLoggedUntil = Date.now() + CG_FAIL_LOG_COOLDOWN_MS;
        console.warn(`[marketPrice] CoinGecko fetch failed: ${err instanceof Error ? err.message : err} — backing off ${CG_BACKOFF_MS / 1000}s, serving manual/stale`);
      }
    }
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
