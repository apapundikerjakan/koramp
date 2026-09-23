import { NextRequest, NextResponse } from 'next/server';
import { getClientIp, rateLimit } from './rateLimit';
import { banGate, readBoundedBody } from './security';

/**
 * Shared public API guard — dedup of banGate + rateLimit preamble
 * previously copy-pasted across 12+ route files.
 *
 * Usage:
 *   const g = await guardPublic(req, 'quote-topup', 30);
 *   if (g.response) return g.response;
 *   // g.ip available
 */
export async function guardPublic(
  req: NextRequest | Request,
  bucket: string,
  max: number,
  windowMs = 60_000,
  opts?: { flood?: boolean },
): Promise<{ ip: string; response: NextResponse | null }> {
  const ip = getClientIp(req as NextRequest);
  const rej = await banGate(ip);
  if (rej) {
    return {
      ip,
      response: NextResponse.json(rej.body, {
        status: rej.status,
        headers: { 'Retry-After': String(rej.retryAfter) },
      }),
    };
  }
  if (!(await rateLimit(bucket, ip, max, windowMs, opts))) {
    return {
      ip,
      response: NextResponse.json(
        { error: { code: 'RATE_LIMITED', message: 'Too many requests. Silakan coba lagi nanti.' } },
        { status: 429 },
      ),
    };
  }
  return { ip, response: null };
}

/** Read + JSON.parse request body with byte-bound enforcement (anti chunked-DoS). */
export async function readJsonBounded<T = unknown>(req: Request): Promise<T> {
  const raw = await readBoundedBody(req);
  try {
    return JSON.parse(raw) as T;
  } catch {
    const { AppError } = await import('./errors');
    throw new AppError(400, 'INVALID_JSON', 'Body JSON tidak valid.');
  }
}

import crypto from 'crypto';

function bearerEqual(auth: string, secret: string): boolean {
  // Constant-time comparison: no early-exit oracle on prefix matches.
  const a = Buffer.from(auth);
  const b = Buffer.from(`Bearer ${secret}`);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Cron guard — fail-closed in production when CRON_SECRET missing.
 * Returns Response on reject, null on allow.
 */
export function guardCron(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { ok: false, error: 'cron_not_configured' },
        { status: 401 },
      );
    }
    return null;
  }
  const auth = req.headers.get('authorization') ?? '';
  if (!bearerEqual(auth, secret)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  return null;
}
