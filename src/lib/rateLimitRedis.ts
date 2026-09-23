/**
 * Redis-backed rate limiting (distributed production).
 *
 * Algorithm: fixed window via a single atomic Lua script (INCR + PEXPIRE only
 * on first hit). Atomicity comes from Redis executing the script as one unit —
 * no GET-then-SET race across instances.
 *
 * Key format: `kipramp:rl:<sha256(identifier:ip)>` — identifiers (which may
 * contain wallet addresses) are hashed; no PII, tokens, or secrets in keys.
 * TTL: exactly windowMs (PEXPIRE set atomically on window creation).
 * Failure: any Redis error propagates → callers fail closed (503), never
 * bypass and never silently fall back to memory.
 *
 * Production contract:
 *   RATE_LIMIT_STORE=distributed
 *   RATE_LIMIT_REDIS_URL=rediss://... (server-only, never NEXT_PUBLIC_*)
 */

import crypto from 'crypto';
import { AppError } from './errors';
import type { RateLimitBackend } from './rateLimit';

/** Narrow Redis surface — injectable fakes for unit tests. */
export interface RedisCommands {
  eval(script: string, numkeys: number, ...args: Array<string | number>): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
  quit(): Promise<unknown>;
}

const KEY_PREFIX = 'kipramp:rl:';

const LUA_FIXED_WINDOW = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return current
`;

export function rateLimitKey(identifierAndIp: string): string {
  return `${KEY_PREFIX}${crypto.createHash('sha256').update(identifierAndIp).digest('hex')}`;
}

export class RedisRateLimitBackend implements RateLimitBackend {
  constructor(private readonly redis: RedisCommands) {}

  private key(identifierAndIp: string): string {
    return rateLimitKey(identifierAndIp);
  }

  check(_key: string, _maxRequests: number, _windowMs: number): boolean {
    // Sync path is meaningless over the network: refuse loudly instead of
    // returning a guess. All production call sites use checkAsync.
    throw new AppError(503, 'RATE_LIMIT_UNAVAILABLE', 'Coba lagi nanti.');
  }

  getRemaining(_key: string, _maxRequests: number): number {
    throw new AppError(503, 'RATE_LIMIT_UNAVAILABLE', 'Coba lagi nanti.');
  }

  async checkAsync(identifierAndIp: string, maxRequests: number, windowMs: number): Promise<boolean> {
    const count = (await this.redis.eval(LUA_FIXED_WINDOW, 1, this.key(identifierAndIp), windowMs)) as number;
    return Number(count) <= maxRequests;
  }

  async getRemainingAsync(identifierAndIp: string, maxRequests: number): Promise<number> {
    const raw = await this.redis.get(this.key(identifierAndIp));
    if (raw === null) return maxRequests;
    return Math.max(0, maxRequests - Number(raw));
  }
}

let singleton: RedisRateLimitBackend | null = null;

/**
 * Create (or reuse) the distributed backend. Fails closed when the URL is
 * missing or Redis is unreachable — callers convert this to 503, never bypass.
 */
export async function createRedisRateLimitBackend(url?: string): Promise<RedisRateLimitBackend> {
  const target = (url ?? process.env.RATE_LIMIT_REDIS_URL ?? '').trim();
  if (!target) {
    throw new AppError(503, 'RATE_LIMIT_UNAVAILABLE', 'Distributed rate limiting is required but not configured.');
  }
  if (singleton) return singleton;
  const { default: Redis } = await import('ioredis');
  const client = new Redis(target, {
    lazyConnect: true,
    enableOfflineQueue: false, // fail fast while disconnected — never hang requests
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    commandTimeout: 3000,
  });
  // Verify reachability NOW so misconfiguration fails closed at startup/first
  // use instead of timing out per request later.
  try {
    await client.ping();
  } catch {
    try { client.disconnect(); } catch { /* ignore */ }
    throw new AppError(503, 'RATE_LIMIT_UNAVAILABLE', 'Rate-limit store unreachable.');
  }
  singleton = new RedisRateLimitBackend(client);
  return singleton;
}

/** Test hook: drop the singleton between tests. */
export function resetRedisBackendForTests(): void {
  singleton = null;
}
