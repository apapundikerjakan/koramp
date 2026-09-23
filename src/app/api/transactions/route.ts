import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, handleError } from '@/lib/response';

export const dynamic = 'force-dynamic';

export interface PublicTransaction {
  publicId: string;
  orderNumber: string;
  side: 'BUY' | 'SELL';
  assetSymbol: string;
  network: string;
  idrAmount: string;
  cryptoAmount: string;
  status: string;
  maskedWallet: string;
  txHash: string | null;
  createdAt: string;
  completedAt: string | null;
}

function maskWallet(addr: string): string {
  if (!addr) return '—';
  if (addr.startsWith('0x') && addr.length > 10) return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  if (addr.length > 8) return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
  return '****';
}

const SIDES = new Set(['BUY', 'SELL']);
const ASSETS = new Set(['SOL', 'ETH', 'BNB']);
const NETWORKS = new Set(['SOLANA', 'BASE', 'BSC']);
// Union of TopUpStatusEnum + SellStatusEnum (src/lib/schemas.ts) — unknown
// values are rejected below instead of reaching Prisma.
const STATUSES = new Set([
  'CREATED', 'PAYMENT_PENDING', 'PAYMENT_CONFIRMED', 'PAYMENT_CREATE_UNKNOWN',
  'PAYMENT_CREATE_FAILED', 'CRYPTO_PROCESSING', 'AWAITING_CRYPTO',
  'CRYPTO_DETECTED', 'CONFIRMING', 'CRYPTO_CONFIRMED', 'PAYOUT_PROCESSING',
  'COMPLETED', 'EXPIRED', 'FAILED',
]);

/**
 * GET /api/transactions — PUBLIC global KORAMP ledger.
 *
 * No wallet required. Returns ONLY orders created through KORAMP
 * (TopUpOrder + SellOrder), newest first, with server-side pagination and
 * optional filters. The response is a safe public DTO: wallet addresses are
 * masked and no payment/bank/provider/internal fields are ever exposed.
 *
 * Query: ?page=1&limit=20&q=&side=BUY|SELL&asset=&network=&status=
 */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const pageRaw = Number(sp.get('page') ?? 1);
    const limitRaw = Number(sp.get('limit') ?? 20);
    const page = Number.isFinite(pageRaw) ? Math.max(1, Math.floor(pageRaw)) : 1;
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, Math.floor(limitRaw)), 50) : 20;
    const q = (sp.get('q') ?? '').trim().slice(0, 100);
    const side = (sp.get('side') ?? '').toUpperCase();
    const asset = (sp.get('asset') ?? '').toUpperCase();
    const network = (sp.get('network') ?? '').toUpperCase();
    const status = (sp.get('status') ?? '').toUpperCase();

    // BUY = TopUpOrder, SELL = SellOrder. Side filter picks the tables.
    const wantBuy = !side || side === 'BUY';
    const wantSell = !side || side === 'SELL';
    if (side && !SIDES.has(side)) {
      return NextResponse.json({ error: { code: 'INVALID_SIDE', message: 'Parameter side harus BUY atau SELL.' } }, { status: 400 });
    }
    if (asset && !ASSETS.has(asset)) {
      return NextResponse.json({ error: { code: 'INVALID_ASSET', message: 'Asset tidak dikenal.' } }, { status: 400 });
    }
    if (network && !NETWORKS.has(network)) {
      return NextResponse.json({ error: { code: 'INVALID_NETWORK', message: 'Network tidak dikenal.' } }, { status: 400 });
    }
    if (status && !STATUSES.has(status)) {
      return NextResponse.json({ error: { code: 'INVALID_STATUS', message: 'Status tidak dikenal.' } }, { status: 400 });
    }

    const buildWhere = () => {
      const OR = q
        ? [
            { orderNumber: { contains: q } },
            { publicId: { contains: q } },
            { cryptoTxHash: { contains: q } },
            { walletAddress: { contains: q } },
          ]
        : undefined;
      return {
        ...(OR ? { OR } : {}),
        ...(asset ? { assetSymbol: asset } : {}),
        ...(network ? { network } : {}),
        ...(status ? { status } : {}),
      };
    };

    const [buyTotal, sellTotal] = await Promise.all([
      wantBuy ? prisma.topUpOrder.count({ where: buildWhere() }) : Promise.resolve(0),
      wantSell ? prisma.sellOrder.count({ where: buildWhere() }) : Promise.resolve(0),
    ]);
    const total = buyTotal + sellTotal;

    // Merged newest-first pagination: over-fetch one page per table, merge,
    // then slice. Correct for reasonable page sizes without a union table.
    const take = page * limit;
    const [buys, sells] = await Promise.all([
      wantBuy
        ? prisma.topUpOrder.findMany({
            where: buildWhere(),
            orderBy: { createdAt: 'desc' },
            take,
            select: {
              publicId: true, orderNumber: true, assetSymbol: true, network: true,
              totalIdr: true, cryptoAmount: true, status: true, walletAddress: true,
              cryptoTxHash: true, createdAt: true, completedAt: true,
            },
          })
        : Promise.resolve([]),
      wantSell
        ? prisma.sellOrder.findMany({
            where: buildWhere(),
            orderBy: { createdAt: 'desc' },
            take,
            select: {
              publicId: true, orderNumber: true, assetSymbol: true, network: true,
              totalIdrPayout: true, cryptoAmount: true, status: true, walletAddress: true,
              cryptoTxHash: true, createdAt: true, completedAt: true,
            },
          })
        : Promise.resolve([]),
    ]);

    const merged: PublicTransaction[] = [
      ...buys.map((o) => ({
        publicId: o.publicId,
        orderNumber: o.orderNumber,
        side: 'BUY' as const,
        assetSymbol: o.assetSymbol,
        network: o.network,
        idrAmount: o.totalIdr.toString(),
        cryptoAmount: o.cryptoAmount.toString(),
        status: o.status,
        maskedWallet: maskWallet(o.walletAddress),
        txHash: o.cryptoTxHash,
        createdAt: o.createdAt.toISOString(),
        completedAt: o.completedAt ? o.completedAt.toISOString() : null,
      })),
      ...sells.map((o) => ({
        publicId: o.publicId,
        orderNumber: o.orderNumber,
        side: 'SELL' as const,
        assetSymbol: o.assetSymbol,
        network: o.network,
        idrAmount: o.totalIdrPayout.toString(),
        cryptoAmount: o.cryptoAmount.toString(),
        status: o.status,
        maskedWallet: maskWallet(o.walletAddress),
        txHash: o.cryptoTxHash,
        createdAt: o.createdAt.toISOString(),
        completedAt: o.completedAt ? o.completedAt.toISOString() : null,
      })),
    ]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice((page - 1) * limit, page * limit);

    return ok({ items: merged, page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) });
  } catch (err) {
    return handleError(err);
  }
}
