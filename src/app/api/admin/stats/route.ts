import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { prisma } from '@/lib/prisma';
import { ok, handleError } from '@/lib/response';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const [totalTopUps, totalSells, pendingTopUps, pendingSells, completedTopUps, completedSells] = await Promise.all([
      prisma.topUpOrder.count(),
      prisma.sellOrder.count(),
      prisma.topUpOrder.count({ where: { status: { in: ['PAYMENT_PENDING', 'PAYMENT_CONFIRMED', 'CRYPTO_PROCESSING'] } } }),
      prisma.sellOrder.count({ where: { status: { in: ['AWAITING_CRYPTO', 'CRYPTO_DETECTED', 'CONFIRMING', 'CRYPTO_CONFIRMED', 'PAYOUT_PROCESSING'] } } }),
      prisma.topUpOrder.count({ where: { status: 'COMPLETED' } }),
      prisma.sellOrder.count({ where: { status: 'COMPLETED' } }),
    ]);
    return ok({ totalTopUps, totalSells, pendingTopUps, pendingSells, completedTopUps, completedSells });
  } catch (err) { return handleError(err); }
}
