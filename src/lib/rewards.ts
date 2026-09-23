/**
 * Reward engine (Phase 2) — server-authoritative eligibility & progress.
 *
 * Source of truth: real KORAMP TopUpOrder/SellOrder rows.
 * One COMPLETED order >= minimum in the active UTC-month cycle = +1.
 * No payout logic lives here (Phase 3). Never trust client counts/amounts.
 */

import crypto from 'crypto';
import Decimal from 'decimal.js';
import { prisma } from '@/lib/prisma';
import { EVM_RE, SOL_RE, sameWallet } from '@/lib/support';

export const REWARD_NETWORKS = ['SOLANA', 'BNB', 'BASE'] as const;
export type RewardNetwork = (typeof REWARD_NETWORKS)[number];

export interface RewardConfigShape {
  enabled: boolean;
  minTransactionIdr: number;
  requiredCount: number;
  rewardMinUsd: string;
  rewardMaxUsd: string;
  cycle: string;
  activeFrom: string | null;
  networks: string[];
  termsVersion: string;
}

export interface QualifyingOrderRef {
  publicId: string;
  orderNumber: string;
  side: 'TOP_UP' | 'SELL';
  totalIdr: string;
  createdAt: Date;
}

/** Current UTC-month cycle id, e.g. "2026-09". */
export function currentCycleId(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function cycleBounds(cycleId: string): { startsAt: Date; endsAt: Date } {
  const [y, m] = cycleId.split('-').map(Number);
  const startsAt = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
  const endsAt = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
  return { startsAt, endsAt };
}

export async function getRewardConfig(): Promise<RewardConfigShape> {
  let cfg = await prisma.rewardConfig.findUnique({ where: { id: 'default' } });
  if (!cfg) {
    cfg = await prisma.rewardConfig.create({ data: { id: 'default' } });
  }
  return {
    enabled: cfg.enabled,
    minTransactionIdr: cfg.minTransactionIdr,
    requiredCount: cfg.requiredCount,
    rewardMinUsd: cfg.rewardMinUsd.toString(),
    rewardMaxUsd: cfg.rewardMaxUsd.toString(),
    cycle: cfg.cycle,
    activeFrom: cfg.activeFrom ? cfg.activeFrom.toISOString() : null,
    networks: cfg.networks.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
    termsVersion: cfg.termsVersion,
  };
}

/** Get-or-create the cycle row (config snapshot frozen at first touch). */
export async function ensureCycle(cycleId: string) {
  const existing = await prisma.rewardCycle.findUnique({ where: { id: cycleId } });
  if (existing) return existing;
  const { startsAt, endsAt } = cycleBounds(cycleId);
  const cfg = await getRewardConfig();
  return prisma.rewardCycle.create({
    data: {
      id: cycleId,
      startsAt,
      endsAt,
      status: 'ACTIVE',
      configSnapshot: JSON.stringify(cfg),
    },
  });
}

/**
 * Authoritative qualifying orders for a wallet in a cycle.
 * COMPLETED only, canonical IDR value >= minimum, created inside the cycle.
 */
export async function getQualifyingOrders(
  walletAddress: string,
  cycleId: string,
  minTransactionIdr: number,
): Promise<QualifyingOrderRef[]> {
  const { startsAt, endsAt } = cycleBounds(cycleId);
  const [topups, sells] = await Promise.all([
    prisma.topUpOrder.findMany({
      where: {
        walletAddress,
        status: 'COMPLETED',
        createdAt: { gte: startsAt, lt: endsAt },
      },
      select: { publicId: true, orderNumber: true, totalIdr: true, createdAt: true },
      take: 5000,
    }),
    prisma.sellOrder.findMany({
      where: {
        walletAddress: walletAddress,
        status: 'COMPLETED',
        createdAt: { gte: startsAt, lt: endsAt },
      },
      select: { publicId: true, orderNumber: true, totalIdrPayout: true, createdAt: true },
      take: 5000,
    }),
  ]);
  // NOTE: exact walletAddress match, consistent with existing wallet-first
  // order history (case variants stored as-is). Matches order ownership
  // checks which compare case-insensitively at claim time.
  const min = new Decimal(minTransactionIdr);
  const out: QualifyingOrderRef[] = [];
  for (const o of topups) {
    if (new Decimal(o.totalIdr.toString()).gte(min)) {
      out.push({ publicId: o.publicId, orderNumber: o.orderNumber, side: 'TOP_UP', totalIdr: o.totalIdr.toString(), createdAt: o.createdAt });
    }
  }
  for (const o of sells) {
    if (new Decimal(o.totalIdrPayout.toString()).gte(min)) {
      out.push({ publicId: o.publicId, orderNumber: o.orderNumber, side: 'SELL', totalIdr: o.totalIdrPayout.toString(), createdAt: o.createdAt });
    }
  }
  return out.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export function isCompatibleWallet(network: string, address: string): boolean {
  if (network === 'SOLANA') return SOL_RE.test(address);
  if (network === 'BNB' || network === 'BASE') return EVM_RE.test(address);
  return false;
}

/** Anti-theft: reservation destination must be the qualifying wallet itself. */
export function isSameWallet(a: string, b: string): boolean {
  return sameWallet(a, b);
}

/** Server-side USD reservation within [min, max], 2 decimals. */
export function rollRewardUsd(minUsd: string, maxUsd: string): string {
  const lo = Math.round(new Decimal(minUsd).toNumber() * 100);
  const hi = Math.round(new Decimal(maxUsd).toNumber() * 100);
  const span = Math.max(0, hi - lo);
  const cents = span === 0 ? lo : lo + (crypto.randomInt(span + 1));
  return (cents / 100).toFixed(2);
}
