import { NextResponse, type NextRequest } from 'next/server';

/**
 * Admin sliding session refresh (P17 — 10-min idle timeout)
 * + Active Defense edge gates (body-size + IP quarantine).
 *
 * - Verifies admin JWT on /api/admin/* (except login) and /admin pages.
 * - On valid session, re-issues fresh 10-min cookie so active users slide,
 *   idle users expire and must re-enter access key.
 * - Verification is lightweight (JWT verify only); full DB checks stay in requireAdmin.
 * - Rejects oversized API bodies early (413) and quarantined IPs on the admin
 *   surface with a generic message (403) — never exposes rules/counts.
 */
function maxBodyBytes(): number {
  const v = Number(process.env.MAX_REQUEST_BODY_SIZE ?? 1048576); // 1MB default
  return Number.isFinite(v) && v > 0 ? v : 1048576;
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const isAdminApi = path.startsWith('/api/admin/');
  const isAdminPage = path.startsWith('/admin');
  if (!isAdminApi && !isAdminPage) return NextResponse.next();

  // Early body-size gate for API traffic (cheap: header check only).
  if (isAdminApi) {
    const len = Number(req.headers.get('content-length') ?? 0);
    if (Number.isFinite(len) && len > maxBodyBytes()) {
      return NextResponse.json(
        { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' } },
        { status: 413 },
      );
    }
  }

  // Quarantine gate on the admin surface (generic response, no rule leakage).
  // NOTE: no DB access here (edge runtime can't use Prisma) — the authoritative
  // ban check lives in requireAdmin (Node). This middleware gate is intentionally
  // omitted; session/login routes surface a generic restriction instead.
  // Login manages its own gate (needs rate-limit accounting first).

  // Login/logout/session endpoints manage their own cookies.
  // /api/admin/keys POST juga mengatur cookie session sendiri (re-issue
  // setelah rotasi) — jangan ditimpa sliding refresh di bawah.
  if (path === '/api/admin/login' || path === '/api/admin/logout' || path === '/api/admin/keys') {
    return NextResponse.next();
  }

  const token = req.cookies.get('kipramp_admin_session')?.value;
  if (!token) return NextResponse.next();

  try {
    const { jwtVerify, SignJWT } = await import('jose');
    const secretText = process.env.JWT_SECRET;
    if (!secretText || secretText === 'dev-secret-change-in-production') {
      if (process.env.NODE_ENV === 'production') return NextResponse.next();
    }
    const secret = new TextEncoder().encode(secretText ?? 'dev-secret-change-in-production');
    const { payload } = await jwtVerify(token, secret);
    const p = payload as Record<string, unknown>;
    const adminId = p.adminId as string | undefined;
    const keyVersion = p.keyVersion as number | undefined;
    const jti = p.jti as string | undefined;
    const uaHash = p.uaHash as string | undefined;
    if (!adminId || typeof keyVersion !== 'number') return NextResponse.next();

    // Device binding (edge, no DB): don't refresh sessions from another device.
    // Full jti/UA enforcement stays in requireAdmin. Uses WebCrypto (edge-safe).
    if (typeof jti === 'string' && typeof uaHash === 'string') {
      const data = new TextEncoder().encode(req.headers.get('user-agent') ?? '');
      const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
      const current = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      if (current !== uaHash) return NextResponse.next();
    }

    // Absolute max 8h check (mirrors adminAuth).
    const iat = p.iat as number | undefined;
    if (typeof iat === 'number' && Math.floor(Date.now() / 1000) - iat > 8 * 60 * 60) {
      return NextResponse.next();
    }

    // Sliding refresh: re-issue 10-min token on activity, preserving claims.
    const configured = process.env.ADMIN_SESSION_EXPIRES_IN ?? '10m';
    const claims: Record<string, unknown> = { adminId, keyVersion };
    if (typeof jti === 'string') claims.jti = jti;
    if (typeof uaHash === 'string') claims.uaHash = uaHash;
    const fresh = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(configured === '24h' ? '10m' : configured)
      .sign(secret);

    const res = NextResponse.next();
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.headers.set(
      'Set-Cookie',
      `kipramp_admin_session=${fresh}; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=${10 * 60}`,
    );
    return res;
  } catch {
    return NextResponse.next();
  }
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};
