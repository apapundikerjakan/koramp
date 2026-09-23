import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ok, handleError } from '@/lib/response';
import { rateLimit, getClientIp } from '@/lib/rateLimit';
import { assertWalletForOrder } from '@/lib/validateWallet';
import { AssetEnum, NetworkEnum, WalletTypeEnum } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;

const schema = z.object({
  address: z.string().min(10).max(100),
  network: NetworkEnum,
  asset: AssetEnum,
  walletType: WalletTypeEnum,
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
    if (!(await rateLimit('wallet-validate', ip, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS))) {
      return NextResponse.json(
        { error: { code: 'RATE_LIMITED', message: 'Too many requests. Silakan coba lagi nanti.' } },
        { status: 429 }
      );
    }
    
    const { readJsonBounded } = await import('@/lib/apiGuard');
    const body = schema.parse(await readJsonBounded(req));

    assertWalletForOrder({ asset: body.asset, network: body.network, walletType: body.walletType, walletAddress: body.address });

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


