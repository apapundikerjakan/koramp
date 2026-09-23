import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/adminAuth';
import { prisma } from '@/lib/prisma';
import { ok, handleError } from '@/lib/response';
import { readJsonBounded } from '@/lib/apiGuard';

export const dynamic = 'force-dynamic';

function err(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

const schema = z.object({
  status: z.enum(['PENDING_PAYOUT', 'PROCESSING', 'DRY_RUN', 'UNDER_REVIEW', 'REJECTED', 'FAILED']),
  reason: z.string().max(500).optional(),
});

/**
 * PATCH /api/admin/rewards/claims/[publicId] — review actions (admin only).
 * UNDER_REVIEW / REJECTED / back to PENDING_PAYOUT. Never edits history.
 */
export async function PATCH(req: NextRequest, { params }: { params: { publicId: string } }) {
  try {
    await requireAdmin(req);
    const parsed = schema.safeParse(await readJsonBounded(req));
    if (!parsed.success) throw parsed.error;
    const claim = await prisma.rewardClaim.findUnique({ where: { publicId: params.publicId } });
    if (!claim) return err('CLAIM_NOT_FOUND', 'Klaim tidak ditemukan.', 404);
    // Terminal/in-flight payout states are immutable via review action —
    // PAID/SUBMITTED/CONFIRMING can only change through reconcile/program.
    if (claim.status === 'PAID' || claim.status === 'SUBMITTED' || claim.status === 'CONFIRMING') {
      return err('IMMUTABLE_STATE', `Klaim berstatus ${claim.status} tidak dapat diubah manual.`, 409);
    }
    const updated = await prisma.rewardClaim.update({
      where: { publicId: params.publicId },
      data: { status: parsed.data.status, reviewReason: parsed.data.reason ?? null },
    });
    try {
      await prisma.auditLog.create({
        data: {
          action: parsed.data.status === 'REJECTED' ? 'REWARD_CLAIM_REJECTED' : 'REWARD_CLAIM_REVIEWED',
          entity: 'RewardClaim', entityId: updated.publicId, actor: 'admin',
          metadata: JSON.stringify({ status: updated.status, reason: parsed.data.reason ?? null }),
        },
      });
    } catch {}
    return ok({ claim: { ...updated, rewardUsd: updated.rewardUsd.toString() } });
  } catch (e) {
    return handleError(e);
  }
}
