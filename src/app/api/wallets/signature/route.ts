import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getBlockchainProvider } from '@/lib/blockchain';
import { validateAssetNetwork, getWalletEcosystem } from '@/lib/assets';
import { ok, handleError } from '@/lib/response';
import { rateLimit, getClientIp } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;

const schema = z.object({
  address: z.string().min(10).max(100),
  network: z.enum(['SOLANA', 'BASE', 'BSC']),
  walletType: z.enum(['EVM', 'SOLANA']),
  asset: z.enum(['SOL', 'ETH', 'BNB']),
  signature: z.string().min(10).max(1000),
  message: z.string().min(10).max(1000),
});

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    // Ban gate: rejected before any expensive work (blockchain RPC, KiPay, DB writes).
    {
      const { banGate } = await import('@/lib/security');
      const rej = await banGate(ip);
      if (rej) return NextResponse.json(rej.body, { status: rej.status, headers: { 'Retry-After': String(rej.retryAfter) } });
    }
    if (!rateLimit('wallet-signature', ip, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)) {
      return NextResponse.json(
        { error: { code: 'RATE_LIMITED', message: 'Too many requests. Silakan coba lagi nanti.' } },
        { status: 429 }
      );
    }

    const body = schema.parse(await req.json());

    if (!validateAssetNetwork(body.asset, body.network)) {
      return handleError(new Error('Asset tidak cocok dengan network'));
    }

    const expectedEcosystem = getWalletEcosystem(body.asset);
    if (body.walletType !== expectedEcosystem) {
      return handleError(new Error('Wallet type tidak cocok'));
    }

    const bc = getBlockchainProvider(body.network);
    const valid = bc.isValidAddress(body.address);
    if (!valid) {
      return handleError(new Error('Alamat wallet tidak valid'));
    }

    // Real cryptographic verification (previously returned verified:true without checking).
    if (body.walletType === 'EVM') {
      try {
        const { verifyMessage } = await import('viem');
        const recovered = await verifyMessage({
          address: body.address as `0x${string}`,
          message: body.message,
          signature: body.signature as `0x${string}`,
        });
        if (!recovered) {
          return NextResponse.json(
            { error: { code: 'INVALID_SIGNATURE', message: 'Signature tidak valid untuk address/message ini' } },
            { status: 401 },
          );
        }
      } catch {
        return NextResponse.json(
          { error: { code: 'INVALID_SIGNATURE', message: 'Signature tidak valid' } },
          { status: 401 },
        );
      }
    } else {
      // Solana ed25519 verification requires tweetnacl (not a direct dep).
      // Never return verified:true without verification — fail closed.
      return NextResponse.json(
        { error: { code: 'NOT_IMPLEMENTED', message: 'Verifikasi signature Solana belum tersedia — gunakan EVM atau hubungi admin' } },
        { status: 501 },
      );
    }

    return ok({
      verified: true,
      address: body.address,
      network: body.network,
      walletType: body.walletType,
      asset: body.asset,
    });
  } catch (err) { return handleError(err); }
}

