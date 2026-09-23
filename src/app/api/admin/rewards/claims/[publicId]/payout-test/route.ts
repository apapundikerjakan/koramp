import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { prisma } from '@/lib/prisma';
import { ok, handleError } from '@/lib/response';
import { sameWallet } from '@/lib/support';
import { getRewardConfig, isCompatibleWallet } from '@/lib/rewards';
import {
  assertDryRunEnabled,
  getPayoutAdapter,
  runPayoutDryRun,
} from '@/lib/rewardPayout';

export const dynamic = 'force-dynamic';

function err(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * POST /api/admin/rewards/claims/[publicId]/payout-test — DRY RUN ONLY.
 * requireAdmin + REWARD_PAYOUT_MODE=dry-run. Never broadcasts.
 * Idempotent: atomic PENDING_PAYOUT→PROCESSING; PROCESSING returns state;
 * DRY_RUN may re-run (fresh quote, no funds); others rejected.
 */
export async function POST(req: NextRequest, { params }: { params: { publicId: string } }) {
  try {
    await requireAdmin(req);
    assertDryRunEnabled();

    const claim = await prisma.rewardClaim.findUnique({ where: { publicId: params.publicId } });
    if (!claim) return err('CLAIM_NOT_FOUND', 'Klaim tidak ditemukan.', 404);
    if (claim.status === 'PROCESSING') {
      return ok({ state: 'PROCESSING', claim: { publicId: claim.publicId, status: claim.status } });
    }
    if (claim.status === 'UNDER_REVIEW' || claim.status === 'REJECTED' || claim.status === 'FAILED') {
      return err('CLAIM_NOT_RUNNABLE', `Klaim berstatus ${claim.status}.`, 409);
    }
    if (claim.status !== 'PENDING_PAYOUT' && claim.status !== 'DRY_RUN') {
      return err('CLAIM_NOT_RUNNABLE', `Klaim berstatus ${claim.status}.`, 409);
    }

    // Atomic lock: only one executor wins.
    const locked = await prisma.rewardClaim.updateMany({
      where: { id: claim.id, status: 'PENDING_PAYOUT' },
      data: { status: 'PROCESSING' },
    });
    const acquired = locked.count === 1 || claim.status === 'DRY_RUN';
    if (!acquired) {
      const current = await prisma.rewardClaim.findUnique({
        where: { publicId: params.publicId },
        select: { publicId: true, status: true },
      });
      return ok({ state: current?.status ?? 'PROCESSING', claim: current });
    }
    if (claim.status === 'DRY_RUN') {
      await prisma.rewardClaim.update({ where: { id: claim.id }, data: { status: 'PROCESSING' } });
    }

    const fail = async (failure: string, detail: string, status: number) => {
      await prisma.rewardClaim.update({ where: { id: claim.id }, data: { status: 'PENDING_PAYOUT' } });
      try {
        await prisma.auditLog.create({
          data: { action: 'REWARD_PAYOUT_VALIDATION_FAILED', entity: 'RewardClaim', entityId: claim.publicId, actor: 'admin', metadata: JSON.stringify({ failure, detail }) },
        });
      } catch {}
      return err('DRY_RUN_FAILED', `${failure}: ${detail}`, status);
    };

    try {
      await prisma.auditLog.create({
        data: { action: 'REWARD_PAYOUT_DRY_RUN_STARTED', entity: 'RewardClaim', entityId: claim.publicId, actor: 'admin', metadata: JSON.stringify({ network: claim.network, rewardUsd: claim.rewardUsd.toString() }) },
      });
    } catch {}

    // Re-validate everything (claim-time values are never trusted blindly).
    if (!sameWallet(claim.destWallet, claim.walletAddress)) {
      return fail('VALIDATION_FAILED', 'Destination is not the earning wallet.', 400);
    }
    if (!isCompatibleWallet(claim.network, claim.destWallet)) {
      return fail('VALIDATION_FAILED', 'Destination incompatible with network.', 400);
    }
    const cfg = await getRewardConfig();
    if (!cfg.networks.includes(claim.network)) {
      return fail('VALIDATION_FAILED', 'Network not in active allowlist.', 400);
    }
    try {
      getPayoutAdapter(claim.network);
    } catch {
      return fail('VALIDATION_FAILED', 'Unsupported network.', 400);
    }

    const dry = await runPayoutDryRun({
      network: claim.network,
      destination: claim.destWallet,
      rewardUsd: claim.rewardUsd.toString(),
    });
    if (!dry.ok) {
      return fail(dry.failure, dry.detail, 502);
    }

    const updated = await prisma.rewardClaim.update({
      where: { id: claim.id },
      data: { status: 'DRY_RUN', dryRunResult: JSON.stringify(dry.result) },
    });
    try {
      await prisma.auditLog.create({
        data: { action: 'REWARD_PAYOUT_DRY_RUN_COMPLETED', entity: 'RewardClaim', entityId: claim.publicId, actor: 'admin', metadata: JSON.stringify({ network: dry.result.network, tokenAmount: dry.result.tokenAmount }) },
      });
    } catch {}
    return ok({
      state: 'DRY_RUN',
      result: dry.result,
      claim: { publicId: updated.publicId, status: updated.status },
    });
  } catch (e) {
    return handleError(e);
  }
}
