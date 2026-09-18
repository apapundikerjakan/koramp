import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { handleError, ok } from '@/lib/response';
import { guardPublic } from '@/lib/apiGuard';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const g = await guardPublic(req, 'assets', 60, 60_000);
    if (g.response) return g.response;
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
