import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { ok, handleError } from '@/lib/response';
import { reconcileRewardPayout } from '@/lib/rewardPayoutLive';

export const dynamic = 'force-dynamic';

function err(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * POST /api/admin/rewards/claims/[publicId]/reconcile — resolve UNKNOWN states.
 * Checks the real chain: confirmed → PAID, reverted → FAILED, not found →
 * PENDING_PAYOUT (amounts kept, safe manual retry). Never broadcasts.
 */
export async function POST(req: NextRequest, { params }: { params: { publicId: string } }) {
  try {
    await requireAdmin(req);
    const { prisma } = await import('@/lib/prisma');
    const claim = await prisma.rewardClaim.findUnique({ where: { publicId: params.publicId }, select: { id: true } });
    if (!claim) return err('CLAIM_NOT_FOUND', 'Klaim tidak ditemukan.', 404);
    const outcome = await reconcileRewardPayout(claim.id);
    return ok({ reconcile: outcome });
  } catch (e) {
    return handleError(e);
  }
}
