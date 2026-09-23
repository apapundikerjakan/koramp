import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/adminAuth';
import { prisma } from '@/lib/prisma';
import { ok, handleError } from '@/lib/response';
import { readJsonBounded } from '@/lib/apiGuard';
import {
  currentCycleId,
  ensureCycle,
  getQualifyingOrders,
  getRewardConfig,
} from '@/lib/rewards';

export const dynamic = 'force-dynamic';

const configSchema = z.object({
  enabled: z.boolean(),
  minTransactionIdr: z.number().int().min(1000).max(1_000_000_000),
  requiredCount: z.number().int().min(1).max(10000),
  rewardMinUsd: z.string().regex(/^\d+(\.\d{1,2})?$/),
  rewardMaxUsd: z.string().regex(/^\d+(\.\d{1,2})?$/),
  networks: z.array(z.enum(['SOLANA', 'BNB', 'BASE'])).min(1),
  activeFrom: z.string().datetime().nullable().optional(),
}).refine((v) => Number(v.rewardMaxUsd) >= Number(v.rewardMinUsd), { message: 'rewardMaxUsd harus >= rewardMinUsd.' });

/**
 * GET /api/admin/rewards — config + active cycle + claims (admin only).
 * ?wallet=&cycle= drills into one wallet incl. qualifying order publicIds.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const sp = req.nextUrl.searchParams;
    const drillWallet = (sp.get('wallet') ?? '').trim();
    const cycleId = (sp.get('cycle') ?? '').trim() || currentCycleId();

    const [cfg, cycle] = await Promise.all([
      getRewardConfig(),
      ensureCycle(cycleId),
    ]);

    if (drillWallet) {
      const qualifying = await getQualifyingOrders(drillWallet, cycleId, cfg.minTransactionIdr);
      const claim = await prisma.rewardClaim.findUnique({
        where: { walletAddress_cycleId: { walletAddress: drillWallet, cycleId } },
      });
      return ok({
        config: cfg,
        cycle: { id: cycle.id, startsAt: cycle.startsAt, endsAt: cycle.endsAt, status: cycle.status },
        wallet: drillWallet,
        qualifyingCount: qualifying.length,
        eligible: qualifying.length >= cfg.requiredCount,
        qualifyingOrders: qualifying.map((o) => ({
          publicId: o.publicId, orderNumber: o.orderNumber, side: o.side, totalIdr: o.totalIdr, createdAt: o.createdAt,
        })),
        claim: claim ? { ...claim, rewardUsd: claim.rewardUsd.toString() } : null,
      });
    }

    const claims = await prisma.rewardClaim.findMany({
      where: { cycleId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return ok({
      config: cfg,
      cycle: { id: cycle.id, startsAt: cycle.startsAt, endsAt: cycle.endsAt, status: cycle.status },
      claims: claims.map((c) => ({ ...c, rewardUsd: c.rewardUsd.toString() })),
    });
  } catch (e) {
    return handleError(e);
  }
}

/** PUT /api/admin/rewards/config — update reward configuration (admin only). */
export async function PUT(req: NextRequest) {
  try {
    await requireAdmin(req);
    const parsed = configSchema.safeParse(await readJsonBounded(req));
    if (!parsed.success) throw parsed.error;
    const v = parsed.data;
    const cfg = await prisma.rewardConfig.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        enabled: v.enabled,
        minTransactionIdr: v.minTransactionIdr,
        requiredCount: v.requiredCount,
        rewardMinUsd: v.rewardMinUsd,
        rewardMaxUsd: v.rewardMaxUsd,
        networks: v.networks.join(','),
        activeFrom: v.activeFrom ? new Date(v.activeFrom) : null,
      },
      update: {
        enabled: v.enabled,
        minTransactionIdr: v.minTransactionIdr,
        requiredCount: v.requiredCount,
        rewardMinUsd: v.rewardMinUsd,
        rewardMaxUsd: v.rewardMaxUsd,
        networks: v.networks.join(','),
        activeFrom: v.activeFrom ? new Date(v.activeFrom) : null,
      },
    });
    try {
      await prisma.auditLog.create({
        data: { action: 'REWARD_CONFIG_UPDATED', entity: 'RewardConfig', entityId: 'default', actor: 'admin' },
      });
    } catch {}
    return ok({ config: { ...cfg, rewardMinUsd: cfg.rewardMinUsd.toString(), rewardMaxUsd: cfg.rewardMaxUsd.toString() } });
  } catch (e) {
    return handleError(e);
  }
}
