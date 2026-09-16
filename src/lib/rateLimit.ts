import type { NextRequest } from 'next/server';

interface RateLimitEntry {
  key: string;
  count: number;
  resetAt: number;
}

/**
 * Rate limiter abstraction (P21).
 *
 * - Local dev: in-memory store (this file).
 * - Production: swap `rateLimiter` with a Redis/Upstash implementation
 *   behind the same `RateLimitBackend` interface. No route code changes needed.
 */
export interface RateLimitBackend {
  check(key: string, maxRequests: number, windowMs: number): boolean;
  getRemaining(key: string, maxRequests: number): number;
}

/**
 * In-memory rate limiter (production sebaiknya pakai Redis).
 * Bisa di-configure per endpoint.
 */
class InMemoryRateLimitBackend implements RateLimitBackend {
  private store: Map<string, RateLimitEntry> = new Map();

  constructor() {
    // Cleanup otomatis setiap 1 menit menggunakan setInterval
    // Di environment serverless, interval ini mungkin tidak berjalan terus-menerus
    // sehingga kita tetap perlu cleanup manual saat check() dipanggil
    try {
      const t = setInterval(() => this.cleanup(), 60_000);
      // Don't keep serverless function alive just for cleanup.
      if (typeof (t as unknown as { unref?: () => void }).unref === 'function') {
        (t as unknown as { unref: () => void }).unref();
      }
    } catch {
      // Jika setInterval tidak didukung (edge), cleanup akan terjadi di check()
    }
  }

  private cleanup(now = Date.now()) {
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.resetAt) {
        this.store.delete(key);
      }
    }
  }

  /**
   * Cek apakah request boleh dilanjutkan.
   */
  check(key: string, maxRequests: number, windowMs: number): boolean {
    const now = Date.now();
    // Opportunistic cleanup (cheap, runs per check in serverless).
    if (this.store.size > 1000) this.cleanup(now);
    const entry = this.store.get(key);

    if (!entry || now > entry.resetAt) {
      this.store.set(key, { key, count: 1, resetAt: now + windowMs });
      return true;
    }

    if (entry.count >= maxRequests) {
      return false;
    }

    entry.count++;
    return true;
  }

  getRemaining(key: string, maxRequests: number): number {
    const entry = this.store.get(key);
    if (!entry) return maxRequests;
    if (Date.now() > entry.resetAt) return maxRequests;
    return Math.max(0, maxRequests - entry.count);
  }
}

// Single instance untuk seluruh aplikasi.
// To use Redis in production, replace with RedisRateLimitBackend implementing same interface.
export const rateLimiter: RateLimitBackend = new InMemoryRateLimitBackend();

/**
 * Extract client IP without blindly trusting x-forwarded-for.
 *
 * - Takes the FIRST IP from x-forwarded-for (client → proxies chain).
 * - Trims whitespace, drops empty/unknown values.
 * - Falls back to x-real-ip.
 * - NOTE: only trust these headers when deployed behind a known proxy/CDN
 *   (Vercel, Cloudflare). In production, configure trusted proxies and
 *   consider using platform-provided IP (e.g. Vercel's x-vercel-forwarded-for).
 */
export function getClientIp(req: NextRequest | Request): string {
  const headers = req.headers;
  const xff = headers.get('x-forwarded-for');
  // Trusted-proxy aware: TRUSTED_PROXY_COUNT=N means N trusted hops, so the
  // client is entry len-N-1. Default 0: first entry (single-proxy/Vercel style).
  // Configure TRUSTED_PROXY_COUNT to match deployment proxy chain; never trust
  // arbitrary XFF values without considering proxy configuration.
  const hops = Number(process.env.TRUSTED_PROXY_COUNT ?? 0);
  if (xff) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) {
      if (Number.isFinite(hops) && hops > 0 && parts.length > hops) {
        const candidate = parts[parts.length - 1 - hops];
        if (candidate && candidate.toLowerCase() !== 'unknown') return candidate;
      } else {
        const first = parts[0];
        if (first && first.toLowerCase() !== 'unknown') return first;
      }
    }
  }
  const realIp = headers.get('x-real-ip')?.trim();
  if (realIp && realIp.toLowerCase() !== 'unknown') return realIp;
  return 'unknown';
}

/**
 * Rate limiting function untuk Next.js API routes.
 * Key = identifier + IP so limits cannot be bypassed by hitting another route,
 * and different endpoints have independent buckets.
 * Tripped limits emit a throttled FLOOD signal (max 1 write/IP/5min) so floods
 * are visible without turning the event log into a DoS vector.
 */
export function rateLimit(
  identifier: string,
  ip: string,
  maxRequests: number,
  windowMs: number,
  opts?: { flood?: boolean },
): boolean {
  const key = `${identifier}:${ip}`;
  const allowed = rateLimiter.check(key, maxRequests, windowMs);
  if (!allowed && opts?.flood !== false) {
    // Fire-and-forget: flood path must stay cheap; helper throttles internally.
    import('@/lib/security').then((m) => m.reportFlood({ ip })).catch(() => {});
  }
  return allowed;
}

export function getRateLimitRemaining(
  identifier: string,
  ip: string,
  maxRequests: number
): number {
  return rateLimiter.getRemaining(`${identifier}:${ip}`, maxRequests);
}

// Preset limits per endpoint type (P21 audit).
export const RATE_LIMITS = {
  // Login admin: longgar (30/15 mnt) — kunci 256-bit tak mungkin di-brute-force,
  // limit hanya meredam probing kunci-bocor + boros query DB. Jangan dihapus total.
  adminLogin: { max: 30, windowMs: 15 * 60 * 1000 },
  quote: { max: 30, windowMs: 60_000 },
  orderCreate: { max: 10, windowMs: 60_000 },
  walletValidate: { max: 30, windowMs: 60_000 },
  pollDeposit: { max: 6, windowMs: 60_000 }, // 1 per 10s
  webhook: { max: 120, windowMs: 60_000 },
  // Aliases used by admin and public endpoints
  admin: { max: 30, windowMs: 60_000 },
  public: { max: 30, windowMs: 60_000 },
} as const;
