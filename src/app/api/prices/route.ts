import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getLivePrice, getSpotPrice } from '@/lib/marketPrice';
import { ok, handleError } from '@/lib/response';
import { guardPublic } from '@/lib/apiGuard';

export const dynamic = 'force-dynamic';

/**
 * GET /api/prices — public indicative rate board (read-only, no DB writes).
 *
 * Feeds the landing "papan kurs" + the topup/sell summary panels. `prices`
 * reuse the same getLivePrice pipeline as quotes (CoinGecko → admin manual →
 * stale → throw), so board numbers can never disagree with quote math.
 * `spot` is best-effort Binance spot (same venue as the TradingView chart)
 * for display only — panels prefer it so the label tracks the chart, and
 * fall back to `prices` when spot is null. Partial failure renders as null
 * (client shows "—"), never a fake number.
 */
export async function GET(req: NextRequest) {
  try {
    const g = await guardPublic(req, 'prices', 30, 60_000);
    if (g.response) return g.response;

    const [sol, eth, bnb, spotSol, spotEth, spotBnb] = await Promise.all([
      getLivePrice('SOL', prisma).then((p) => p.toString()).catch(() => null),
      getLivePrice('ETH', prisma).then((p) => p.toString()).catch(() => null),
      getLivePrice('BNB', prisma).then((p) => p.toString()).catch(() => null),
      // Same-venue spot as the TradingView chart (display only, best-effort).
      getSpotPrice('SOL').then((p) => p?.toString() ?? null).catch(() => null),
      getSpotPrice('ETH').then((p) => p?.toString() ?? null).catch(() => null),
      getSpotPrice('BNB').then((p) => p?.toString() ?? null).catch(() => null),
    ]);

    // Public order limits — same global fee row the admin settings form edits
    // (SOL_TOP_UP reference), so the widget min/max always follows the dashboard.
    const feeRow = await prisma.feeConfig
      .findFirst({ where: { assetSymbol: 'SOL', type: 'TOP_UP' } })
      .catch(() => null);

    return ok({
      prices: { SOL: sol, ETH: eth, BNB: bnb },
      spot: { SOL: spotSol, ETH: spotEth, BNB: spotBnb },
      limits: {
        minOrderIdr: feeRow?.minOrderIdr?.toString() ?? '50000',
        maxOrderIdr: feeRow?.maxOrderIdr?.toString() ?? '100000000',
      },
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    return handleError(err);
  }
}
