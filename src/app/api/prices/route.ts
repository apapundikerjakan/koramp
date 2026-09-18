import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getLivePrice } from '@/lib/marketPrice';
import { ok, handleError } from '@/lib/response';
import { guardPublic } from '@/lib/apiGuard';

export const dynamic = 'force-dynamic';

/**
 * GET /api/prices — public indicative rate board (read-only, no DB writes).
 *
 * Feeds the landing "papan kurs" + the topup/sell summary panels. Reuses the
 * same getLivePrice pipeline as quotes (CoinGecko → admin manual → stale →
 * throw), so board numbers can never disagree with quote math. Partial
 * failure renders as null (client shows "—"), never a fake number.
 */
export async function GET(req: NextRequest) {
  try {
    const g = await guardPublic(req, 'prices', 30, 60_000);
    if (g.response) return g.response;

    const [sol, eth, bnb] = await Promise.all([
      getLivePrice('SOL', prisma).then((p) => p.toString()).catch(() => null),
      getLivePrice('ETH', prisma).then((p) => p.toString()).catch(() => null),
      getLivePrice('BNB', prisma).then((p) => p.toString()).catch(() => null),
    ]);

    return ok({
      prices: { SOL: sol, ETH: eth, BNB: bnb },
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    return handleError(err);
  }
}
