import { NextRequest, NextResponse } from 'next/server';
import { clearAdminSessionCookie, verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/adminAuth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  // Server-side: release the single-device slot so a new login isn't blocked.
  try {
    const cookieHeader = req.headers.get('cookie') ?? '';
    const token = Object.fromEntries(
      cookieHeader.split(';').map((c) => {
        const [name, ...rest] = c.trim().split('=');
        return [name, rest.join('=')];
      }),
    )[SESSION_COOKIE_NAME];
    if (token) {
      const payload = await verifySessionToken(token);
      await prisma.adminAccessKey.updateMany({
        where: { id: payload.adminId, activeSessionJti: payload.jti },
        data: { activeSessionJti: null },
      });
    }
  } catch {
    // Logout must always succeed client-side even if session already invalid.
  }
  const cookieValue = clearAdminSessionCookie();

  return new NextResponse(JSON.stringify({
    loggedOut: true
  }), {
    status: 200,
    headers: {
      'Set-Cookie': cookieValue,
      'Content-Type': 'application/json',
    },
  });
}
