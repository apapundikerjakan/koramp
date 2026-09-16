/**
 * GET  /api/admin/prices  — current price cache status
 * POST /api/admin/prices  — force-refresh all prices from CoinGecko
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { refreshAllPrices, getPriceCacheStatus } from '@/lib/marketPrice';
import { ok, handleError } from '@/lib/response';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const status = getPriceCacheStatus();
    return ok({ prices: status });
  } catch (err) { return handleError(err); }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
    const prices = await refreshAllPrices();
    return ok({ refreshed: true, prices });
  } catch (err) { return handleError(err); }
}
