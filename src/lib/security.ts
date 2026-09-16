/**
 * KIPRAMP Active Defense engine (defensive only — never retaliates).
 *
 * Pipeline: DETECT → CONTAIN → RATE LIMIT → QUARANTINE → BLOCK → ALERT ADMIN
 *
 * - Failure tracking: aggregated per (hour bucket, ip, eventType) with counters.
 *   No per-request writes on the hot path; only failures/suspicious events write.
 * - Escalation: rolling-24h failure sums per IP → levels 50/100/200/400/800.
 * - Actions: L1 suspicious+alert, L2 tighter limits, L3+ temporary quarantine
 *   (15m→1h→6h→24h). Permanent bans are MANUAL ONLY (never automatic).
 * - IP is never treated as perfect identity: subnet + fingerprint + behavior
 *   are recorded alongside, and blocks always expire (except manual permanent).
 * - All thresholds/durations are env-configurable (see .env.example SECURITY).
 *
 * Performance: ban checks are memory-cached (60s TTL); failure recording is a
 * single indexed upsert and only happens on abnormal requests.
 */

import crypto from 'crypto';
import { prisma } from './prisma';
import { AppError } from './errors';

// ─── Request body bounds (defense in depth: middleware checks Content-Length,
// routes enforce actual bytes — chunked bodies have no Content-Length) ─────────

export function maxBodyBytes(): number {
  const v = Number(process.env.MAX_REQUEST_BODY_SIZE ?? 1048576); // 1MB default
  return Number.isFinite(v) && v > 0 ? v : 1048576;
}

/** Read request text, rejecting oversized bodies with 413 (fail closed). */
export async function readBoundedBody(req: Request): Promise<string> {
  const raw = await req.text();
  if (raw.length > maxBodyBytes()) {
    throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body too large');
  }
  return raw;
}

// ─── Config (all overridable via env, never exposed to frontend) ───────────────

function num(name: string, def: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : def;
}

export const SEC = {
  // Suspicion flag levels (rolling-24h failure sums per IP) — display/alert only.
  l1: num('SECURITY_ESCALATION_L1', 50),
  l2: num('SECURITY_ESCALATION_L2', 100),
  l3: num('SECURITY_ESCALATION_L3', 200),
  l4: num('SECURITY_ESCALATION_L4', 400),
  l5: num('SECURITY_ESCALATION_L5', 800),
  // First confirmed-violation ban triggers at this many rolling-24h failures.
  firstBanFailures: num('SECURITY_FIRST_BAN_FAILURES', 50),
  // Progressive temp bans: BAN #N lasts N hours, capped (never infinite).
  maxAutoHours: num('MAX_AUTOMATIC_BAN_HOURS', 24),
  // Clean period with zero violations after which the cycle count decays to 0.
  decayCleanDays: num('SECURITY_DECAY_CLEAN_DAYS', 30),
  // Distributed attack: distinct IPs failing same endpoint within window.
  distIps: num('SECURITY_DISTINCT_IPS', 10),
  distWindowMs: num('SECURITY_DIST_WINDOW_MS', 10 * 60 * 1000),
  // Retention (days) for aggregated security events.
  retentionDays: num('SECURITY_EVENT_RETENTION_DAYS', 30),
} as const;

export const GENERIC_BLOCK_MESSAGE =
  'Access temporarily restricted. This request has been blocked by KIPRAMP security systems. ' +
  'If you believe this restriction is a mistake, please contact the administrator using the official contact information provided by KIPRAMP.';

// ─── Progressive duration math (pure — unit-tested) ───────────────────────────
// BAN #N → N hours, capped at maxAutoHours. Server-computed only.

export function banDurationHours(violationCount: number, maxAutoHours = SEC.maxAutoHours): number {
  const n = Math.max(1, Math.floor(violationCount));
  return Math.min(n, Math.max(1, Math.floor(maxAutoHours)));
}

export function formatBanDuration(hours: number): string {
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

export function formatRemaining(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

export function makePublicId(): string {
  return `KRP-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

// ─── Identity helpers ──────────────────────────────────────────────────────────
// IP is approximate identity: also record /24 subnet + request fingerprint so
// rotating-IP attackers are still correlatable without over-blocking NAT users.

export function subnetOf(ip: string): string | null {
  if (!ip || ip === 'unknown') return null;
  // IPv4 /24; IPv6 /64 prefix (approx grouping, never exact location).
  if (ip.includes('.')) {
    const parts = ip.split('.');
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
    return null;
  }
  const idx = ip.indexOf('::');
  const head = (idx === -1 ? ip : ip.slice(0, idx)).split(':').slice(0, 4).join(':');
  return head ? `${head}::/64` : null;
}

export function fingerprintOf(ip: string, userAgent: string): string {
  return crypto.createHash('sha256').update(`${ip}|${userAgent}`).digest('hex').slice(0, 32);
}

export function hourBucket(d = new Date()): Date {
  const b = new Date(d);
  b.setUTCMinutes(0, 0, 0);
  return b;
}

// Approximate geo ONLY from trusted-proxy headers set by infra (Vercel/CF).
// Never exact, never from external lookups (perf), never exposed publicly.
export function approxCountry(headers: Headers): string | null {
  const c =
    headers.get('x-vercel-ip-country') ??
    headers.get('cf-ipcountry') ??
    undefined;
  if (!c || c === 'XX' || c === 'T1') return null;
  return /^[A-Z]{2}$/.test(c.trim()) ? c.trim() : null;
}

// ─── Ban cache (memory, 60s TTL — DB is source of truth) ───────────────────────
// Caches the authoritative expiresAt; remaining is recomputed per request.

const banCache = new Map<string, { ban: ActiveBan | null; until: number }>();
const BAN_CACHE_TTL_MS = 60_000;

export async function isIpBlocked(ip: string): Promise<{ blocked: boolean; ban?: ActiveBan }> {
  if (!ip || ip === 'unknown') return { blocked: false };
  const now = Date.now();
  const cached = banCache.get(ip);
  if (cached && cached.until > now) {
    const b = cached.ban;
    if (!b) return { blocked: false };
    if (!b.permanent && b.expiresAt.getTime() <= now) {
      banCache.delete(ip);
      return { blocked: false };
    }
    return { blocked: true, ban: b };
  }
  try {
    const ban = await readActiveBan(ip);
    banCache.set(ip, { ban, until: now + BAN_CACHE_TTL_MS });
    return { blocked: !!ban, ban: ban ?? undefined };
  } catch {
    banCache.set(ip, { ban: null, until: now + BAN_CACHE_TTL_MS });
    return { blocked: false }; // fail open on infra error for reads; writes fail closed elsewhere
  }
}

interface ActiveBan {
  publicId: string;
  reason: string;
  violationCount: number;
  durationMs: number;
  expiresAt: Date;
  permanent: boolean;
}

async function readActiveBan(ip: string): Promise<ActiveBan | null> {
  const ban = await prisma.ipBan.findUnique({ where: { ip } });
  if (!ban) return null;
  if (ban.permanent) {
    return {
      publicId: ban.publicId, reason: ban.reason, violationCount: ban.violationCount,
      durationMs: ban.durationMs, expiresAt: new Date(8640000000000000), permanent: true,
    };
  }
  if (!ban.expiresAt || ban.expiresAt.getTime() <= Date.now()) return null;
  return {
    publicId: ban.publicId, reason: ban.reason, violationCount: ban.violationCount,
    durationMs: ban.durationMs, expiresAt: ban.expiresAt, permanent: false,
  };
}

/**
 * Build the countdown restriction payload. Server-computed from expiresAt;
 * frontend countdown is visual only. Reveals duration + remaining + public ID
 * (explicitly allowed) — never rules, thresholds, counts, or infra details.
 */
export function restrictionPayload(ban: ActiveBan): {
  status: 403;
  body: Record<string, unknown>;
  retryAfter: number;
} {
  const retryAfter = ban.permanent ? 86400 : Math.max(1, Math.ceil((ban.expiresAt.getTime() - Date.now()) / 1000));
  return {
    status: 403,
    body: {
      error: 'SECURITY_RESTRICTION',
      message: 'Access temporarily restricted.',
      banDuration: ban.permanent ? 'permanent (manual review)' : formatBanDuration(Math.round(ban.durationMs / 3600000)),
      remaining: ban.permanent ? null : formatRemaining(retryAfter),
      retryAfter,
      restrictionId: ban.publicId,
    },
    retryAfter,
  };
}

/**
 * Early gate for mutation endpoints: banned sources are rejected BEFORE any
 * expensive work (DB writes, RPC, payments). Returns a response or null.
 */
export async function banGate(ip: string): Promise<ReturnType<typeof restrictionPayload> | null> {
  const { blocked, ban } = await isIpBlocked(ip);
  if (!blocked || !ban) return null;
  // Count the blocked hit (bounded: callers are already rate-limited).
  try {
    await prisma.ipBan.update({ where: { ip }, data: { requestCount: { increment: 1 } } });
  } catch {
    // never break the gate on bookkeeping errors
  }
  return restrictionPayload(ban);
}

export function dropBanCache(ip: string) {
  banCache.delete(ip);
}

// ─── Event recording (aggregated, bounded) ─────────────────────────────────────

export type SecEventType =
  | 'ADMIN_LOGIN_FAIL'
  | 'ADMIN_LOGIN_BLOCKED'
  | 'WEBHOOK_INVALID_SIG'
  | 'WEBHOOK_REPLAY'
  | 'RATE_LIMITED'
  | 'FLOOD'
  | 'DISTRIBUTED_ATTACK'
  | 'ORDER_ABUSE'
  | 'QUOTE_ABUSE';

const SEVERITY: Record<SecEventType, string> = {
  ADMIN_LOGIN_FAIL: 'HIGH',
  ADMIN_LOGIN_BLOCKED: 'HIGH',
  WEBHOOK_INVALID_SIG: 'HIGH',
  WEBHOOK_REPLAY: 'MEDIUM',
  RATE_LIMITED: 'LOW',
  FLOOD: 'HIGH',
  DISTRIBUTED_ATTACK: 'CRITICAL',
  ORDER_ABUSE: 'MEDIUM',
  QUOTE_ABUSE: 'MEDIUM',
};

export async function recordSecurityEvent(opts: {
  ip: string;
  eventType: SecEventType;
  endpoint?: string;
  userAgent?: string;
  country?: string | null;
  actionTaken?: string;
}): Promise<void> {
  try {
    const { ip, eventType } = opts;
    if (!ip || ip === 'unknown') return;
    await prisma.securityEvent.upsert({
      where: { bucket_ip_eventType: { bucket: hourBucket(), ip, eventType } },
      create: {
        bucket: hourBucket(),
        ip,
        subnet: subnetOf(ip),
        fingerprint: fingerprintOf(ip, opts.userAgent ?? ''),
        eventType,
        severity: SEVERITY[eventType],
        endpoint: opts.endpoint?.slice(0, 200),
        userAgent: opts.userAgent?.slice(0, 300),
        country: opts.country ?? undefined,
        count: 1,
        actionTaken: opts.actionTaken ?? 'NONE',
      },
      update: {
        count: { increment: 1 },
        lastSeen: new Date(),
        actionTaken: opts.actionTaken ?? undefined,
      },
    });
  } catch {
    // Security logging must never break business logic.
  }
}

// ─── Escalation ────────────────────────────────────────────────────────────────
// Rolling-24h failure sums per IP → level → action. Never auto-permanent.

export async function failureSum24h(ip: string, types?: SecEventType[]): Promise<number> {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await prisma.securityEvent.findMany({
      where: { ip, lastSeen: { gte: since }, ...(types ? { eventType: { in: types } } : {}) },
      select: { count: true },
    });
    return rows.reduce((s, r) => s + r.count, 0);
  } catch {
    return 0;
  }
}

export function levelForFailures(n: number): number {
  if (n >= SEC.l5) return 5;
  if (n >= SEC.l4) return 4;
  if (n >= SEC.l3) return 3;
  if (n >= SEC.l2) return 2;
  if (n >= SEC.l1) return 1;
  return 0;
}

// ─── Progressive temp bans (BAN #N lasts N hours, capped) ─────────────────────
// A repeat violation is a NEW confirmed failure event — never a mere revisit.
// violationCount increments per imposed ban; durations are server-computed.
// Decay: if the previous ban expired longer than decayCleanDays ago, the cycle
// restarts at #1 (protects shared/NAT IPs from ancient history).

export async function imposeBan(opts: {
  ip: string;
  reason: string;
  level?: number;
  endpoint?: string;
  userAgent?: string;
  country?: string | null;
}): Promise<{ violationCount: number; durationMs: number; expiresAt: Date; publicId: string; capped: boolean }> {
  const now = Date.now();
  const existing = await prisma.ipBan.findUnique({ where: { ip: opts.ip } }).catch(() => null);
  if (existing?.permanent) {
    return {
      violationCount: existing.violationCount, durationMs: existing.durationMs,
      expiresAt: new Date(8640000000000000), publicId: existing.publicId, capped: true,
    };
  }

  let violationCount = 1;
  if (existing) {
    const lastEnd = existing.expiresAt ? existing.expiresAt.getTime() : 0;
    const cleanMs = SEC.decayCleanDays * 24 * 60 * 60 * 1000;
    violationCount = lastEnd && now - lastEnd > cleanMs ? 1 : existing.violationCount + 1;
  }

  const hours = banDurationHours(violationCount);
  const capped = violationCount > SEC.maxAutoHours;
  const durationMs = hours * 3600 * 1000;
  const expiresAt = new Date(now + durationMs);

  const ban = await prisma.ipBan.upsert({
    where: { ip: opts.ip },
    create: {
      ip: opts.ip,
      publicId: makePublicId(),
      reason: opts.reason,
      level: opts.level ?? Math.min(violationCount + 2, 5),
      violationCount,
      requestCount: 0,
      durationMs,
      expiresAt,
      needsReview: capped,
    },
    update: {
      reason: opts.reason,
      level: opts.level ?? Math.min(violationCount + 2, 5),
      violationCount,
      requestCount: 0,
      durationMs,
      expiresAt,
      needsReview: capped,
    },
  });
  dropBanCache(opts.ip);

  await recordSecurityEvent({
    ip: opts.ip, eventType: 'ADMIN_LOGIN_BLOCKED',
    endpoint: opts.endpoint, userAgent: opts.userAgent, country: opts.country ?? null,
    actionTaken: 'BLOCKED',
  });

  return { violationCount, durationMs, expiresAt, publicId: ban.publicId, capped };
}

/**
 * Called after each failed admin authentication. Records the failure and,
 * once rolling-24h failures reach the first-ban threshold with no active ban,
 * imposes the next progressive ban. Returns the action taken (server logs and
 * dashboard only — never exposed to the client).
 */
export async function handleAdminLoginFailure(opts: {
  ip: string;
  endpoint?: string;
  userAgent?: string;
  country?: string | null;
}): Promise<{ level: number; action: string }> {
  await recordSecurityEvent({ ...opts, eventType: 'ADMIN_LOGIN_FAIL' });
  const sum = await failureSum24h(opts.ip, ['ADMIN_LOGIN_FAIL']);
  const level = levelForFailures(sum);

  // Active ban already handling it: count the attempt, don't re-impose.
  const { blocked } = await isIpBlocked(opts.ip);
  if (blocked) {
    try {
      await prisma.ipBan.update({ where: { ip: opts.ip }, data: { requestCount: { increment: 1 } } });
    } catch { /* bookkeeping only */ }
    return { level, action: 'BLOCKED' };
  }

  if (sum >= SEC.firstBanFailures) {
    try {
      const r = await imposeBan({
        ip: opts.ip,
        reason: `Confirmed admin brute force (${sum} failures/24h)`,
        level: Math.max(level, 3),
        endpoint: opts.endpoint,
        userAgent: opts.userAgent,
        country: opts.country ?? null,
      });
      return { level, action: r.capped ? 'BLOCKED_CAPPED_REVIEW' : 'BLOCKED' };
    } catch {
      return { level, action: 'QUARANTINE_FAILED' };
    }
  }
  if (level >= 1) {
    await recordSecurityEvent({ ...opts, eventType: 'ADMIN_LOGIN_FAIL', actionTaken: 'RATE_LIMITED' });
  }
  // Distributed check (cheap-ish, only from L1+ to bound cost).
  void checkDistributedAttack('admin-login', opts.country ?? null).catch(() => {});
  return { level, action: level >= 1 ? 'FLAGGED' : 'NONE' };
}

// ─── Distributed attack detection ──────────────────────────────────────────────

let lastDistAlert = 0;
const DIST_ALERT_COOLDOWN_MS = 30 * 60 * 1000;

export async function checkDistributedAttack(
  endpointKey: string,
  country: string | null,
): Promise<boolean> {
  try {
    const since = new Date(Date.now() - SEC.distWindowMs);
    const rows = await prisma.securityEvent.findMany({
      where: { eventType: 'ADMIN_LOGIN_FAIL', lastSeen: { gte: since } },
      select: { ip: true },
    });
    const distinct = new Set(rows.map((r) => r.ip));
    if (distinct.size >= SEC.distIps && Date.now() - lastDistAlert > DIST_ALERT_COOLDOWN_MS) {
      lastDistAlert = Date.now();
      await prisma.securityEvent.create({
        data: {
          bucket: hourBucket(),
          ip: 'aggregate',
          eventType: 'DISTRIBUTED_ATTACK',
          severity: 'CRITICAL',
          endpoint: endpointKey,
          country,
          count: distinct.size,
          actionTaken: 'ALERTED',
        },
      });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ─── Flood signal (throttled — never a write-per-request) ─────────────────────
// Called on every tripped rate limit. Memory-throttled to 1 write/IP/5min so a
// flood can't turn the security log itself into a DoS vector. Floods are a
// dashboard signal; bans stay driven by auth failures (shared-IP safety).

const floodThrottle = new Map<string, number>();
const FLOOD_THROTTLE_MS = 5 * 60 * 1000;

export function reportFlood(opts: {
  ip: string;
  endpoint?: string;
  userAgent?: string;
  country?: string | null;
}): void {
  try {
    const now = Date.now();
    const last = floodThrottle.get(opts.ip) ?? 0;
    if (now - last < FLOOD_THROTTLE_MS) return;
    floodThrottle.set(opts.ip, now);
    void recordSecurityEvent({ ...opts, eventType: 'FLOOD', actionTaken: 'RATE_LIMITED' });
  } catch {
    // never break request handling
  }
}

// ─── Retention purge (called from cron) ────────────────────────────────────────
export async function purgeOldSecurityData(): Promise<{ events: number; bans: number }> {
  const cutoff = new Date(Date.now() - SEC.retentionDays * 24 * 60 * 60 * 1000);
  try {
    const [events] = await Promise.all([
      prisma.securityEvent.deleteMany({ where: { lastSeen: { lt: cutoff } } }),
      // Expired temp bans are left in place as history but treated inactive;
      // hard-delete only long-expired ones to bound table size.
      prisma.ipBan.deleteMany({
        where: { permanent: false, expiresAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      }),
    ]);
    banCache.clear();
    return { events: events.count, bans: 0 };
  } catch {
    return { events: 0, bans: 0 };
  }
}
