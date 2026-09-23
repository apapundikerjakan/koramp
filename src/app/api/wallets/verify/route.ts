import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ok, handleError } from '@/lib/response';
import { guardPublic, readJsonBounded } from '@/lib/apiGuard';
import { verifyChallenge, issueWalletSession } from '@/lib/walletAuth';

export const dynamic = 'force-dynamic';

const schema = z.object({
  challengeId: z.string().min(1).max(100),
  signature: z.string().min(8).max(500),
});

/**
 * POST /api/wallets/verify — verify challenge signature, issue a 15-min
 * purpose-bound session token (x-wallet-auth header value).
 */
export async function POST(req: NextRequest) {
  try {
    const g = await guardPublic(req, 'wallet-verify', 20);
    if (g.response) return g.response;
    const parsed = schema.safeParse(await readJsonBounded(req));
    if (!parsed.success) throw parsed.error;
    const c = await verifyChallenge(parsed.data.challengeId, parsed.data.signature);
    const { token, expiresAt } = issueWalletSession({
      walletAddress: c.walletAddress,
      ecosystem: c.ecosystem,
      purpose: c.purpose,
    });
    return ok({ token, expiresAt, walletAddress: c.walletAddress, ecosystem: c.ecosystem });
  } catch (e) {
    return handleError(e);
  }
}
