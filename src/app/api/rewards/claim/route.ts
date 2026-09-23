import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ok, handleError } from '@/lib/response';
import { guardPublic, readJsonBounded } from '@/lib/apiGuard';
import { sameWallet } from '@/lib/support';
import { requireWalletSession } from '@/lib/walletAuth';
import {
  REWARD_NETWORKS,
  currentCycleId,
  ensureCycle,
  getQualifyingOrders,
  getRewardConfig,
  isCompatibleWallet,
  rollRewardUsd,
} from '@/lib/rewards';

export const dynamic = 'force-dynamic';

function err(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

const schema = z.object({
  walletAddress: z.string().min(10).max(100),
  network: z.enum(['SOLANA', 'BNB', 'BASE']),
  destWallet: z.string().min(10).max(100),
  // Literal true: server rejects missing/false — checkbox state alone proves nothing.
  termsAccepted: z.literal(true, { errorMap: () => ({ message: 'Ketentuan reward harus disetujui.' }) }),
});

/**
 * POST /api/rewards/claim — reservation only (Phase 2, NO payout).
 * Every value is re-derived server-side: progress, amount, eligibility,
 * network support, wallet compatibility. destWallet must equal the
 * qualifying wallet (anti-theft). One claim per wallet per cycle via
 * @@unique — double-click/tabs/replay collapse to a single row.
 */
export async function POST(req: NextRequest) {
  try {
    const g = await guardPublic(req, 'rewards-claim', 10);
    if (g.response) return g.response;
    // Proven ownership FIRST: unauthenticated callers learn nothing, not
    // even input-validation details.
    const session = await requireWalletSession(req, 'REWARD_CLAIM');
    const parsed = schema.safeParse(await readJsonBounded(req));
    if (!parsed.success) {
      return err('INVALID_INPUT', parsed.error.issues[0]?.message ?? 'Input tidak valid.', 400);
    }
    const { walletAddress, network, destWallet } = parsed.data;
    // Proven ownership: session wallet must equal the claimed wallet.
    if (!sameWallet(walletAddress, session.walletAddress)) {
      return err('WALLET_MISMATCH', 'Wallet sesi tidak cocok dengan wallet klaim.', 403);
    }
    const wallet = session.walletAddress;
    if (!(REWARD_NETWORKS as readonly string[]).includes(network)) {
      return err('UNSUPPORTED_NETWORK', 'Network tidak didukung.', 400);
    }
    // Anti-theft: reservation can only target the qualifying wallet itself.
    if (!sameWallet(destWallet, walletAddress)) {
      return err('DEST_MISMATCH', 'Wallet tujuan harus sama dengan wallet yang memenuhi syarat.', 403);
    }
    if (!isCompatibleWallet(network, destWallet)) {
      return err('WALLET_INCOMPATIBLE', `Wallet tidak kompatibel dengan network ${network}.`, 400);
    }

    const cfg = await getRewardConfig();
    if (!cfg.enabled) return err('REWARD_DISABLED', 'Program reward sedang tidak aktif.', 400);
    if (!cfg.networks.includes(network)) {
      return err('UNSUPPORTED_NETWORK', 'Network tidak didukung untuk siklus ini.', 400);
    }
    const cycleId = currentCycleId();
    await ensureCycle(cycleId);

    // Authoritative recount at claim time (never trust client progress).
    // Uses the PROVEN session wallet, never the body-claimed address.
    const qualifying = await getQualifyingOrders(wallet, cycleId, cfg.minTransactionIdr);
    if (qualifying.length < cfg.requiredCount) {
      return err('NOT_ELIGIBLE', 'Syarat transaksi belum terpenuhi.', 400);
    }

    const rewardUsd = rollRewardUsd(cfg.rewardMinUsd, cfg.rewardMaxUsd);
    const snapshot = JSON.stringify({
      minTransactionIdr: cfg.minTransactionIdr,
      requiredCount: cfg.requiredCount,
      rewardMinUsd: cfg.rewardMinUsd,
      rewardMaxUsd: cfg.rewardMaxUsd,
      cycle: cycleId,
      termsVersion: cfg.termsVersion,
    });
    try {
      const claim = await prisma.rewardClaim.create({
        data: {
          walletAddress: wallet,
          cycleId,
          qualifyingCount: qualifying.length,
          configSnapshot: snapshot,
          rewardUsd,
          network,
          destWallet,
          policyVersion: cfg.termsVersion,
          status: 'PENDING_PAYOUT',
          termsAcceptedAt: new Date(),
        },
      });
      try {
        await prisma.auditLog.create({
          data: { action: 'REWARD_CLAIM_CREATED', entity: 'RewardClaim', entityId: claim.publicId, actor: wallet, metadata: JSON.stringify({ cycle: cycleId, network }) },
        });
      } catch {}
      return ok({
        claim: { publicId: claim.publicId, status: claim.status, rewardUsd, network, qualifyingCount: qualifying.length, createdAt: claim.createdAt },
        payoutActive: false,
      }, 201);
    } catch (e: unknown) {
      // @@unique([walletAddress, cycleId]) — concurrent/duplicate claims.
      if (typeof e === 'object' && e !== null && 'code' in e && (e as { code: string }).code === 'P2002') {
        const existing = await prisma.rewardClaim.findUnique({
          where: { walletAddress_cycleId: { walletAddress: wallet, cycleId } },
          select: { publicId: true, status: true, rewardUsd: true, network: true, qualifyingCount: true, createdAt: true },
        });
        return ok({
          claim: existing ? { ...existing, rewardUsd: existing.rewardUsd.toString() } : null,
          duplicate: true,
          payoutActive: false,
        }, 200);
      }
      throw e;
    }
  } catch (e) {
    return handleError(e);
  }
}
