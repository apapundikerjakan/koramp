import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { prisma } from '@/lib/prisma';
import { ok, handleError } from '@/lib/response';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/stats/timeseries?range=7d|30d|90d
 *
 * Per-day analytics (new endpoint — legacy /api/admin/stats untouched):
 * `{ date, revenue, expenses, topupVolume, topupCount, sellVolume, sellCount, visits }`
 *
 * Definitions (product-confirmed):
 * - Penjualan (top up): COMPLETED TopUpOrder, sum totalIdr, count.
 * - Pembelian (sell): COMPLETED SellOrder, sum totalIdrPayout, count.
 * - Pendapatan: sum serviceFee of COMPLETED orders (both sides).
 *   tax is EXCLUDED (forwarded to state, not platform revenue).
 * - Pengeluaran: sum networkFee (both sides) + Payment.feeAmount
 *   (provider gateway fee). Per-order SOL ATA usage isn't stored, so it can't
 *   be attributed — excluded (see note below).
 * - Kunjungan: sum PageVisit.count. No PageVisit rows yet → zeros.
 *
 * Day bucket = UTC date of completedAt (fallback createdAt). Aggregation
 * happens in JS after fetch so SQLite-dev and Postgres-prod behave the same.
 */
const RANGES = { '7d': 7, '30d': 30, '90d': 90 } as const;

interface DayRow {
  date: string;
  revenue: number;
  expenses: number;
  topupVolume: number;
  topupCount: number;
  sellVolume: number;
  sellCount: number;
  visits: number;
}

const num = (v: unknown): number => {
  const n = Number(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
};

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const rawRange = new URL(req.url).searchParams.get('range') ?? '7d';
    const days = RANGES[rawRange as keyof typeof RANGES] ?? RANGES['7d'];

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const since = new Date(today.getTime() - (days - 1) * 24 * 60 * 60 * 1000);

    const rows = new Map<string, DayRow>();
    for (let i = 0; i < days; i++) {
      const d = new Date(since.getTime() + i * 24 * 60 * 60 * 1000);
      const key = dayKey(d);
      rows.set(key, {
        date: key, revenue: 0, expenses: 0,
        topupVolume: 0, topupCount: 0, sellVolume: 0, sellCount: 0, visits: 0,
      });
    }
    const bucket = (d: Date | null | undefined): DayRow | null => {
      if (!d) return null;
      return rows.get(dayKey(d)) ?? null;
    };

    const [topups, sells, gatewayFees, visits] = await Promise.all([
      prisma.topUpOrder.findMany({
        where: {
          status: 'COMPLETED',
          OR: [{ completedAt: { gte: since } }, { completedAt: null, createdAt: { gte: since } }],
        },
        select: { completedAt: true, createdAt: true, totalIdr: true, serviceFee: true, networkFee: true },
      }),
      prisma.sellOrder.findMany({
        where: {
          status: 'COMPLETED',
          OR: [{ completedAt: { gte: since } }, { completedAt: null, createdAt: { gte: since } }],
        },
        select: { completedAt: true, createdAt: true, totalIdrPayout: true, serviceFee: true, networkFee: true },
      }),
      prisma.payment.findMany({
        where: { paidAt: { gte: since }, feeAmount: { not: null } },
        select: { paidAt: true, feeAmount: true },
      }),
      prisma.pageVisit.findMany({
        where: { day: { gte: since } },
        select: { day: true, count: true },
      }),
    ]);

    for (const o of topups) {
      const b = bucket(o.completedAt ?? o.createdAt);
      if (!b) continue;
      b.topupVolume += num(o.totalIdr);
      b.topupCount += 1;
      b.revenue += num(o.serviceFee);
      b.expenses += num(o.networkFee);
    }
    for (const o of sells) {
      const b = bucket(o.completedAt ?? o.createdAt);
      if (!b) continue;
      b.sellVolume += num(o.totalIdrPayout);
      b.sellCount += 1;
      b.revenue += num(o.serviceFee);
      b.expenses += num(o.networkFee);
    }
    for (const p of gatewayFees) {
      const b = bucket(p.paidAt);
      if (!b) continue;
      b.expenses += num(p.feeAmount);
    }
    for (const v of visits) {
      const b = bucket(v.day);
      if (!b) continue;
      b.visits += v.count;
    }

    const round2 = (n: number) => Math.round(n * 100) / 100;
    return ok({
      range: `${days}d`,
      days: [...rows.values()].map((r) => ({
        ...r,
        revenue: round2(r.revenue),
        expenses: round2(r.expenses),
        topupVolume: round2(r.topupVolume),
        sellVolume: round2(r.sellVolume),
      })),
      notes: {
        revenue: 'serviceFee COMPLETED (tax excluded)',
        expenses: 'networkFee + provider feeAmount (per-order ATA usage not stored — excluded)',
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
