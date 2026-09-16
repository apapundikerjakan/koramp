import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createSellOrder } from '@/lib/orders';
import { ok, handleError } from '@/lib/response';
import { ValidationError } from '@/lib/errors';
import { getBlockchainProvider } from '@/lib/blockchain';
import { validateAssetNetwork, getWalletEcosystem } from '@/lib/assets';
import { rateLimit, getClientIp } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

// Rate limiting: 10 request per menit per IP untuk mencegah spam
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

const schema = z.object({
  walletAddress: z.string().min(10).max(100),
  walletType: z.enum(['EVM', 'SOLANA']),
  quoteId: z.string().uuid(),
  asset: z.enum(['SOL', 'ETH', 'BNB']),
  network: z.enum(['SOLANA', 'BASE', 'BSC']),
  // Validasi ketat untuk data bank
  bankName: z.string().min(2).max(100).refine(
    (name) => /^[a-zA-Z0-9\s\u002D\u002E]+$/.test(name),
    'Bank name hanya boleh mengandung huruf, angka, spasi, dan tanda baca dasar'
  ),
  accountNumber: z.string().min(8).max(20).refine(
    (acc) => /^[0-9]+$/.test(acc),
    'Nomor rekening hanya boleh berisi angka'
  ).transform((acc) => acc.replace(/\s+/g, '')), // Hapus spasi
  accountName: z.string().min(2).max(100).refine(
    (name) => /^[ -~\u00A0-\u00FF\u4e00-\u9fff\uAC00-\uD7AF]+$/.test(name) || /^[ -~]+$/.test(name),
    'Nama pemilik rekening tidak valid'
  ),
});

export async function POST(req: NextRequest) {
  try {
    // Rate limiting
    const ip = getClientIp(req);
    // Ban gate: rejected before any expensive work (blockchain RPC, KiPay, DB writes).
    {
      const { banGate } = await import('@/lib/security');
      const rej = await banGate(ip);
      if (rej) return NextResponse.json(rej.body, { status: rej.status, headers: { 'Retry-After': String(rej.retryAfter) } });
    }
    if (!rateLimit('sell-order', ip, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)) {
      return NextResponse.json(
        { error: { code: 'RATE_LIMITED', message: 'Too many requests. Silakan coba lagi nanti.' } },
        { status: 429 }
      );
    }
    
    const body = schema.parse(await req.json());

    if (!validateAssetNetwork(body.asset, body.network)) {
      throw new ValidationError(`Asset ${body.asset} tidak cocok dengan network ${body.network}`);
    }
    if (body.walletType !== getWalletEcosystem(body.asset)) {
      throw new ValidationError(`Wallet type ${body.walletType} tidak cocok untuk asset ${body.asset}`);
    }
    const bc = getBlockchainProvider(body.network);
    if (!bc.isValidAddress(body.walletAddress)) {
      throw new ValidationError(`Alamat wallet tidak valid untuk network ${body.network}`);
    }

    const result = await createSellOrder(body);
    return ok({ order: result.order }, 201);
  } catch (err) { return handleError(err); }
}


