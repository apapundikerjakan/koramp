import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { adminLogin, getAdminSessionCookie, isTotpEnabled } from '@/lib/adminAuth';
import { readBoundedBody } from '@/lib/security';
import { handleError } from '@/lib/response';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

const schema = z.object({
  // Normalize API-side too: strip whitespace, lowercase (hex case-insensitive).
  adminKey: z.string().transform((s) => s.replace(/\s+/g, '').toLowerCase()).pipe(
    z.string().length(64).regex(/^[a-f0-9]{64}$/, 'Invalid admin access key'),
  ),
  // Second factor: rotating authenticator code (required when ADMIN_TOTP_SECRET set).
  totpCode: z.string().max(12).optional().default(''),
});

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);

    // Ban gate FIRST (before rate limiting): banned sources are rejected
    // without consuming buckets or touching business logic. Countdown + ID
    // are server-computed; no rules/thresholds leak.
    {
      const { banGate } = await import('@/lib/security');
      const rej = await banGate(ip);
      if (rej) {
        return NextResponse.json(rej.body, { status: rej.status, headers: { 'Retry-After': String(rej.retryAfter) } });
      }
    }

    // Login failures are tracked precisely as ADMIN_LOGIN_FAIL; skip the
    // generic FLOOD signal here to avoid double counting.
    if (!rateLimit('admin-login', ip, RATE_LIMITS.adminLogin.max, RATE_LIMITS.adminLogin.windowMs, { flood: false })) {
      return NextResponse.json(
        { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Silakan coba lagi nanti.' } },
        { status: 429 }
      );
    }

    const body = JSON.parse(await readBoundedBody(req));
    const parsed = schema.parse(body);
    const result = await adminLogin(parsed.adminKey, req.headers.get('user-agent') ?? '', parsed.totpCode);

    // Set session cookie (10-min sliding, HttpOnly, Secure in prod, SameSite=Lax)
    const cookieValue = getAdminSessionCookie(result.token);

    return new NextResponse(JSON.stringify({
      authenticated: true,
      admin: true,
      totpRequired: isTotpEnabled(),
    }), {
      status: 200,
      headers: {
        'Set-Cookie': cookieValue,
        'Content-Type': 'application/json',
      },
    });
  } catch (err) {
    // Failed attempts feed the escalation engine (async, never blocks response shape).
    // Client always gets a generic message — never the level/count/algorithm.
    try {
      const { handleAdminLoginFailure, approxCountry } = await import('@/lib/security');
      const ip = getClientIp(req);
      await handleAdminLoginFailure({
        ip,
        endpoint: '/api/admin/login',
        userAgent: req.headers.get('user-agent') ?? undefined,
        country: approxCountry(req.headers),
      });
    } catch {
      // Security logging must never break the response.
    }
    // Jangan expose detail error (TOTP vs key dibedakan hanya untuk UX lokal).
    if (err instanceof Error && err.message.includes('Invalid admin access key')) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Invalid admin access key' } },
        { status: 401 }
      );
    }
    if (err instanceof Error && err.message.includes('authenticator')) {
      return NextResponse.json(
        { error: { code: 'INVALID_TOTP', message: 'Kode authenticator salah atau kedaluwarsa' } },
        { status: 401 }
      );
    }
    return handleError(err);
  }
}
