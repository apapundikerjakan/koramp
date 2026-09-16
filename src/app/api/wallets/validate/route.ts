import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getBlockchainProvider } from '@/lib/blockchain';
import { validateAssetNetwork, getWalletEcosystem } from '@/lib/assets';
import { ok, handleError } from '@/lib/response';
import { ValidationError } from '@/lib/errors';
import { rateLimit, getClientIp } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;

const schema = z.object({
  address: z.string().min(10).max(100),
  network: z.enum(['SOLANA', 'BASE', 'BSC']),
  asset: z.enum(['SOL', 'ETH', 'BNB']),
  walletType: z.enum(['EVM', 'SOLANA']),
  message: z.string().optional(),
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
    if (!rateLimit('wallet-validate', ip, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)) {
      return NextResponse.json(
        { error: { code: 'RATE_LIMITED', message: 'Too many requests. Silakan coba lagi nanti.' } },
        { status: 429 }
      );
    }
    
    const body = schema.parse(await req.json());

    // Validate asset/network compatibility
    if (!validateAssetNetwork(body.asset, body.network)) {
      throw new ValidationError(`Asset ${body.asset} tidak cocok dengan network ${body.network}`);
    }

    // Validate wallet type matches asset ecosystem
    const expectedEcosystem = getWalletEcosystem(body.asset);
    if (body.walletType !== expectedEcosystem) {
      throw new ValidationError(`Wallet type ${body.walletType} tidak cocok untuk asset ${body.asset}`);
    }

    // Validate address format using blockchain provider
    const bc = getBlockchainProvider(body.network);
    const valid = bc.isValidAddress(body.address);
    if (!valid) {
      throw new ValidationError(`Alamat wallet tidak valid untuk network ${body.network}`);
    }

    // If message provided, verify it's not empty and return verification challenge
    if (body.message) {
      return ok({
        valid: true,
        address: body.address,
        network: body.network,
        asset: body.asset,
        walletType: body.walletType,
        challenge: 'Sign this message to verify wallet ownership. This signature does not authorize a crypto transfer.',
      });
    }

    return ok({ valid: true, address: body.address, network: body.network, asset: body.asset, walletType: body.walletType });
  } catch (err) { return handleError(err); }
}


