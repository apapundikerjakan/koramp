import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { ok, handleError } from '@/lib/response';
import { assertLiveEnabled, executeRewardPayout } from '@/lib/rewardPayoutLive';

export const dynamic = 'force-dynamic';

function err(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * POST /api/admin/rewards/claims/[publicId]/payout — LIVE broadcast.
 * requireAdmin + REWARD_PAYOUT_MODE=live (dormant otherwise → 503, no-op).
 * No automatic worker calls this; admin-triggered only.
 */
export async function POST(req: NextRequest, { params }: { params: { publicId: string } }) {
  try {
    await requireAdmin(req);
    assertLiveEnabled();
    const { prisma } = await import('@/lib/prisma');
    const claim = await prisma.rewardClaim.findUnique({ where: { publicId: params.publicId }, select: { id: true } });
    if (!claim) return err('CLAIM_NOT_FOUND', 'Klaim tidak ditemukan.', 404);
    const outcome = await executeRewardPayout(claim.id);
    return ok({ payout: outcome });
  } catch (e) {
    return handleError(e);
  }
}
