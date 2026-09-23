import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, handleError } from '@/lib/response';
import { guardPublic } from '@/lib/apiGuard';
import { EVM_RE, SOL_RE } from '@/lib/support';
import {
  currentCycleId,
  ensureCycle,
  getQualifyingOrders,
  getRewardConfig,
} from '@/lib/rewards';

export const dynamic = 'force-dynamic';

function err(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * GET /api/rewards?wallet=0x...
 * Authoritative progress for the caller's wallet. Counts only — order IDs
 * are admin-only. Client-submitted counts are never accepted (none exist).
 */
export async function GET(req: NextRequest) {
  try {
    const g = await guardPublic(req, 'rewards-read', 30);
    if (g.response) return g.response;
    const wallet = (req.nextUrl.searchParams.get('wallet') ?? '').trim();
    if (!wallet) return err('WALLET_REQUIRED', 'Wallet address diperlukan.', 400);
    if (!EVM_RE.test(wallet) && !SOL_RE.test(wallet)) {
      return err('INVALID_WALLET_ADDRESS', 'Alamat wallet tidak valid.', 400);
    }
    const cfg = await getRewardConfig();
    const cycleId = currentCycleId();
    await ensureCycle(cycleId);
    const qualifying = cfg.enabled ? await getQualifyingOrders(wallet, cycleId, cfg.minTransactionIdr) : [];
    const qualifyingCount = qualifying.length;
    const eligible = cfg.enabled && qualifyingCount >= cfg.requiredCount;
    const claim = await prisma.rewardClaim.findUnique({
      where: { walletAddress_cycleId: { walletAddress: wallet, cycleId } },
      select: { publicId: true, status: true, rewardUsd: true, network: true, txHash: true, createdAt: true },
    });
    return ok({
      cycle: cycleId,
      qualifyingCount,
      requiredCount: cfg.requiredCount,
      minimumTransactionAmount: cfg.minTransactionIdr,
      progressPercent: cfg.requiredCount > 0 ? Math.min(100, Math.round((qualifyingCount / cfg.requiredCount) * 100)) : 0,
      eligible,
      enabled: cfg.enabled,
      claimed: !!claim,
      claimStatus: claim?.status ?? null,
      claim: claim
        ? { publicId: claim.publicId, status: claim.status, rewardUsd: claim.rewardUsd.toString(), network: claim.network, txHash: claim.txHash, createdAt: claim.createdAt }
        : null,
      configuration: {
        minTransactionIdr: cfg.minTransactionIdr,
        requiredCount: cfg.requiredCount,
        rewardMinUsd: cfg.rewardMinUsd,
        rewardMaxUsd: cfg.rewardMaxUsd,
        networks: cfg.networks,
      },
      termsVersion: cfg.termsVersion,
      // Phase 2: payout is NOT implemented.
      payoutActive: false,
    });
  } catch (e) {
    return handleError(e);
  }
}
