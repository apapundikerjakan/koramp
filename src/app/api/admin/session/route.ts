import { NextRequest, NextResponse } from 'next/server';
import { getAdminSessionStatus, requireAdmin, refreshSessionToken, getAdminSessionCookie, isTotpEnabled } from '@/lib/adminAuth';
import { getClientIp } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // Restricted sources get a generic flag (no auth details, no rules).
  // Includes server-computed countdown + public restriction ID (allowed).
  try {
    const { isIpBlocked, formatRemaining } = await import('@/lib/security');
    const { blocked, ban } = await isIpBlocked(getClientIp(req));
    if (blocked && ban) {
      const retryAfter = ban.permanent ? 86400 : Math.max(1, Math.ceil((ban.expiresAt.getTime() - Date.now()) / 1000));
      return NextResponse.json({
        authenticated: false,
        restricted: true,
        message: 'Access temporarily restricted.',
        remaining: ban.permanent ? null : formatRemaining(retryAfter),
        retryAfter,
        restrictionId: ban.publicId,
      });
    }
  } catch {
    // Fall through to normal session handling on gate infra errors.
  }
  const status = await getAdminSessionStatus(req);
  if (!status.authenticated) {
    // Public flag (not sensitive): tells the login page whether to ask for a code.
    return NextResponse.json({ ...status, totpEnabled: isTotpEnabled() });
  }
  // Sliding refresh on session check (P17).
  try {
    const payload = await requireAdmin(req);
    const fresh = await refreshSessionToken(payload);
    const res = NextResponse.json(status);
    res.headers.set('Set-Cookie', getAdminSessionCookie(fresh));
    return res;
  } catch {
    return NextResponse.json(status);
  }
}
