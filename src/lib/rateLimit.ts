import type { NextRequest } from 'next/server';
import { AppError } from './errors';

interface RateLimitEntry {
  key: string;
  count: number;
  resetAt: number;
}

/**
 * Rate limiter abstraction (P21).
 *
 * - Local dev: in-memory store (MemoryRateLimitStore below).
 * - Production: implement a Redis backend behind RateLimitBackend and return
 *   it from resolveBackend() when RATE_LIMIT_STORE=distributed is configured.
 *   No route code changes needed. Until then, distributed mode fails closed.
 */
export interface RateLimitBackend {
  check(key: string, maxRequests: number, windowMs: number): boolean;
  getRemaining(key: string, maxRequests: number): number;
  /** Async variants (required for network-backed stores like Redis). */
  checkAsync(key: string, maxRequests: number, windowMs: number): Promise<boolean>;
  getRemainingAsync(key: string, maxRequests: number): Promise<number>;
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

  async checkAsync(key: string, maxRequests: number, windowMs: number): Promise<boolean> {
    return this.check(key, maxRequests, windowMs);
  }

  async getRemainingAsync(key: string, maxRequests: number): Promise<number> {
    return this.getRemaining(key, maxRequests);
  }
}

// Single memory instance for local development/tests.
const memoryBackend = new InMemoryRateLimitBackend();

export type RateLimitStoreMode = 'memory' | 'distributed';

/**
 * Deployment mode selector.
 * - `memory` (default): single-instance counters. Correct for local dev/test.
 * - `distributed`: REQUIRED for multi-instance production. This build ships
 *   WITHOUT a distributed backend: resolving it throws 503 (fail closed).
 *   To provision: implement RedisRateLimitBackend (SET key value NX PX for
 *   atomic fixed-window, or a Lua sliding-window) using RATE_LIMIT_REDIS_URL
 *   (+ TLS/token), return it from resolveBackend() when configured, and add
 *   a live integration test against real Redis. There is deliberately NO
 *   silent downgrade to memory — a misconfigured production must refuse
 *   traffic, not silently lose limits.
 */
export function getRateLimitMode(): RateLimitStoreMode {
  const m = (process.env.RATE_LIMIT_STORE ?? 'memory').trim().toLowerCase();
  return m === 'distributed' ? 'distributed' : 'memory';
}

async function resolveBackend(): Promise<RateLimitBackend> {
  if (getRateLimitMode() === 'distributed') {
    return getDistributedBackend();
  }
  return memoryBackend;
}

/**
 * Distributed backend resolution (async import: ioredis loads only in
 * distributed mode, never in local/test memory mode).
 * Missing/unreachable Redis → throws 503 (fail closed, no memory fallback).
 */
async function getDistributedBackend(): Promise<RateLimitBackend> {
  const url = (process.env.RATE_LIMIT_REDIS_URL ?? '').trim();
  if (!url) {
    throw new AppError(503, 'RATE_LIMIT_UNAVAILABLE', 'Distributed rate limiting is required but not configured.');
  }
  const { createRedisRateLimitBackend } = await import('./rateLimitRedis');
  return createRedisRateLimitBackend(url);
}

/** Exposed for tests: the active backend instance. */
export function getRateLimiter(): RateLimitBackend {
  if (getRateLimitMode() === 'distributed') {
    throw new AppError(503, 'RATE_LIMIT_UNAVAILABLE', 'Distributed rate limiting is required but not configured.');
  }
  return memoryBackend;
}

/**
 * Extract client IP — hardened against X-Forwarded-For spoofing.
 *
 * Priority (first match wins):
 *  1. Platform-verified headers set by infra (cannot be spoofed by client
 *     when deployed behind that platform): cf-connecting-ip (Cloudflare),
 *     x-vercel-forwarded-for (Vercel), fastly-client-ip.
 *  2. x-real-ip (set by trusted reverse proxy).
 *  3. X-Forwarded-For selected via TRUSTED_PROXY_COUNT (default 0 = first
 *     entry, single-proxy/Vercel style). Configure TRUSTED_PROXY_COUNT to
 *     match the deployment proxy chain; with untrusted direct traffic XFF
 *     is client-controlled and must not be solely trusted for bans.
 */
export function getClientIp(req: NextRequest | Request): string {
  const headers = req.headers;
  const pick = (v: string | null): string | null => {
    if (!v) return null;
    const t = v.trim();
    if (!t || t.toLowerCase() === 'unknown') return null;
    // Basic IP sanity — prevents header-injection garbage becoming a bucket key.
    if (/^[0-9a-fA-F.:]{3,45}$/.test(t)) return t;
    return null;
  };
  // 1. Platform-verified single-IP headers.
  for (const h of ['cf-connecting-ip', 'x-vercel-forwarded-for', 'fastly-client-ip']) {
    const v = pick(headers.get(h)?.split(',')[0]?.trim() ?? null);
    if (v) return v;
  }
  // 2. Reverse-proxy header.
  const realIp = pick(headers.get('x-real-ip'));
  // 3. XFF chain.
  const xff = headers.get('x-forwarded-for');
  // Trusted-proxy aware: TRUSTED_PROXY_COUNT=N means N trusted hops, so the
  // client is entry len-N-1. Default 0: first entry (single-proxy/Vercel style).
  // Configure TRUSTED_PROXY_COUNT to match deployment proxy chain; never trust
  // arbitrary XFF values without considering proxy configuration.
  const hops = Number(process.env.TRUSTED_PROXY_COUNT ?? 0);
  if (xff) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) {
      let candidate: string | undefined;
      if (Number.isFinite(hops) && hops > 0 && parts.length > hops) {
        candidate = parts[parts.length - 1 - hops];
      } else {
        candidate = parts[0];
      }
      const v = candidate ? pick(candidate) : null;
      if (v) return v;
    }
  }
  if (realIp) return realIp;
  return 'unknown';
}

/**
 * Rate limiting function untuk Next.js API routes.
 * Key = identifier + IP so limits cannot be bypassed by hitting another route,
 * and different endpoints have independent buckets.
 * Tripped limits emit a throttled FLOOD signal (max 1 write/IP/5min) so floods
 * are visible without turning the event log into a DoS vector.
 *
 * Fail-safe: backend resolution/selection errors DENY the request (503),
 * never bypass the limit. A limiter that cannot count must not open the gate.
 */
export async function rateLimit(
  identifier: string,
  ip: string,
  maxRequests: number,
  windowMs: number,
  opts?: { flood?: boolean },
): Promise<boolean> {
  let allowed: boolean;
  try {
    allowed = await (await resolveBackend()).checkAsync(`${identifier}:${ip}`, maxRequests, windowMs);
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(503, 'RATE_LIMIT_UNAVAILABLE', 'Coba lagi nanti.');
  }
  if (!allowed && opts?.flood !== false) {
    // Fire-and-forget: flood path must stay cheap; helper throttles internally.
    import('@/lib/security').then((m) => m.reportFlood({ ip })).catch(() => {});
  }
  return allowed;
}

export async function getRateLimitRemaining(
  identifier: string,
  ip: string,
  maxRequests: number
): Promise<number> {
  try {
    return await (await resolveBackend()).getRemainingAsync(`${identifier}:${ip}`, maxRequests);
  } catch {
    return 0; // Unknown budget reads as exhausted (deny-safe for header consumers).
  }
}

// Preset limits per endpoint type (P21 audit).
export const RATE_LIMITS = {
  // Login admin: strict (10/15 mnt) — TOTP 6-digit space + IP-spoof hardening.
  // Previously 30/15m; tightened to bound TOTP guessing with rotated IPs.
  adminLogin: { max: 10, windowMs: 15 * 60 * 1000 },
  quote: { max: 30, windowMs: 60_000 },
  orderCreate: { max: 10, windowMs: 60_000 },
  walletValidate: { max: 30, windowMs: 60_000 },
  pollDeposit: { max: 6, windowMs: 60_000 }, // 1 per 10s
  webhook: { max: 120, windowMs: 60_000 },
  // Aliases used by admin and public endpoints
  admin: { max: 30, windowMs: 60_000 },
  public: { max: 30, windowMs: 60_000 },
} as const;
