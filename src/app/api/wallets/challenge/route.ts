import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ok, handleError } from '@/lib/response';
import { guardPublic, readJsonBounded } from '@/lib/apiGuard';
import { createChallenge } from '@/lib/walletAuth';

export const dynamic = 'force-dynamic';

const schema = z.object({
  walletAddress: z.string().min(10).max(100),
  ecosystem: z.enum(['EVM', 'SOLANA']),
  purpose: z.enum(['REWARD_CLAIM', 'SUPPORT']),
});

/**
 * POST /api/wallets/challenge — issue a single-use signing challenge.
 * No auth needed (this STARTS the proof). Rate limited.
 */
export async function POST(req: NextRequest) {
  try {
    const g = await guardPublic(req, 'wallet-challenge', 20);
    if (g.response) return g.response;
    const parsed = schema.safeParse(await readJsonBounded(req));
    if (!parsed.success) throw parsed.error;
    const c = await createChallenge(parsed.data.walletAddress, parsed.data.ecosystem, parsed.data.purpose);
    return ok({ challengeId: c.id, message: c.message, expiresAt: c.expiresAt });
  } catch (e) {
    return handleError(e);
  }
}
