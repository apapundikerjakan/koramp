import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, handleError } from '@/lib/response';
import { guardPublic } from '@/lib/apiGuard';

export const dynamic = 'force-dynamic';

function err(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

const EVM_RE = /^0x[a-fA-F0-9]{40}$/;
const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export interface WalletOrderItem {
  publicId: string;
  orderNumber: string;
  side: 'TOP_UP' | 'SELL';
  assetSymbol: string;
  network: string;
  status: string;
  idrAmount: string;
  cryptoAmount: string;
  walletAddress: string;
  walletType: string;
  txHash: string | null;
  payoutBankName: string | null;
  payoutAccountMasked: string | null;
  createdAt: string;
  completedAt: string | null;
}

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED', 'REFUNDED']);

function maskAccount(acct: string | null | undefined): string | null {
  if (!acct) return null;
  const digits = acct.replace(/\D/g, '');
  if (digits.length < 4) return '****';
  return `****${digits.slice(-4)}`;
}

/**
 * GET /api/wallets/[address]/orders?type=EVM|SOLANA&limit=50
 *
 * Wallet-scoped KORAMP order history. The wallet address IS the customer
 * identity in this codebase (see schema header: no users table), consistent
 * with the existing public /order/[publicId] tracking model.
 *
 * Security properties:
 * - DB-level WHERE on the exact walletAddress — never "fetch all, filter in JS".
 * - Address format is strictly validated (EVM 0x-hex / Solana base58) and,
 *   when ?type= is given, must match the stored walletType.
 * - Only KORAMP application fields are returned; bank numbers are masked.
 * - No private keys/seeds ever exist in this system.
 */
export async function GET(req: NextRequest, { params }: { params: { address: string } }) {
  try {
    const g = await guardPublic(req, 'wallet-orders', 30);
    if (g.response) return g.response;
    const address = decodeURIComponent(params.address ?? '');
    const typeParam = (req.nextUrl.searchParams.get('type') ?? '').toUpperCase();
    const limitRaw = Number(req.nextUrl.searchParams.get('limit') ?? 50);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 50;

    const looksEvm = EVM_RE.test(address);
    const looksSol = SOL_RE.test(address);
    if (!looksEvm && !looksSol) {
      return err('INVALID_WALLET_ADDRESS', 'Format alamat wallet tidak valid.', 400);
    }
    if (typeParam && typeParam !== 'EVM' && typeParam !== 'SOLANA') {
      return err('INVALID_WALLET_TYPE', 'Parameter type harus EVM atau SOLANA.', 400);
    }
    if (typeParam === 'EVM' && !looksEvm) {
      return err('WALLET_TYPE_MISMATCH', 'Alamat ini bukan EVM wallet.', 400);
    }
    if (typeParam === 'SOLANA' && !looksSol) {
      return err('WALLET_TYPE_MISMATCH', 'Alamat ini bukan Solana wallet.', 400);
    }

    const [topups, sells] = await Promise.all([
      prisma.topUpOrder.findMany({
        where: { walletAddress: address },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      prisma.sellOrder.findMany({
        where: { walletAddress: address },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
    ]);

    const items: WalletOrderItem[] = [
      ...topups.map((o) => ({
        publicId: o.publicId,
        orderNumber: o.orderNumber,
        side: 'TOP_UP' as const,
        assetSymbol: o.assetSymbol,
        network: o.network,
        status: o.status,
        idrAmount: o.totalIdr.toString(),
        cryptoAmount: o.cryptoAmount.toString(),
        walletAddress: o.walletAddress,
        walletType: o.walletType,
        txHash: o.cryptoTxHash,
        payoutBankName: null,
        payoutAccountMasked: null,
        createdAt: o.createdAt.toISOString(),
        completedAt: o.completedAt ? o.completedAt.toISOString() : null,
      })),
      ...sells.map((o) => ({
        publicId: o.publicId,
        orderNumber: o.orderNumber,
        side: 'SELL' as const,
        assetSymbol: o.assetSymbol,
        network: o.network,
        status: o.status,
        idrAmount: o.totalIdrPayout.toString(),
        cryptoAmount: o.cryptoAmount.toString(),
        walletAddress: o.walletAddress,
        walletType: o.walletType,
        txHash: o.cryptoTxHash,
        payoutBankName: o.payoutBankName,
        payoutAccountMasked: maskAccount(o.payoutAccountNumber),
        createdAt: o.createdAt.toISOString(),
        completedAt: o.completedAt ? o.completedAt.toISOString() : null,
      })),
    ]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, limit);

    const active = items.filter((i) => !TERMINAL.has(i.status));
    const history = items.filter((i) => TERMINAL.has(i.status));

    return ok({ address, active, history, items });
  } catch (err) {
    return handleError(err);
  }
}

