import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { handleError } from '@/lib/response';
import { rateLimit, getClientIp } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    if (!rateLimit('assets', ip, 60, 60_000)) {
      return NextResponse.json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }, { status: 429 });
    }
    const assets = await prisma.asset.findMany({
      where: { isActive: true },
      include: { network: true },
      orderBy: { symbol: 'asc' },
    });
    const res = NextResponse.json({ assets });
    // Assets change rarely — allow 60s edge cache for efficiency.
    res.headers.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=30');
    return res;
  } catch (err) { return handleError(err); }
}
