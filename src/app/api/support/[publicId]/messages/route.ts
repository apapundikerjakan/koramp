import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ok, handleError } from '@/lib/response';
import { rateLimit, getClientIp } from '@/lib/rateLimit';
import { readJsonBounded } from '@/lib/apiGuard';
import { requireWalletSession } from '@/lib/walletAuth';
import {
  sameWallet,
  nextStatusOnMessage,
  SUPPORT_MESSAGE_MAX,
} from '@/lib/support';

export const dynamic = 'force-dynamic';

function err(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

const schema = z.object({
  message: z.string().trim().min(1, 'Pesan tidak boleh kosong.').max(SUPPORT_MESSAGE_MAX),
  walletAddress: z.string().min(10).max(100).optional(),
});

/**
 * POST /api/support/[publicId]/messages
 * Customer sends a follow-up. Wallet ownership verified against the ticket
 * (query ?wallet= preferred; body.walletAddress accepted for compat but
 * must match the ticket — never trusted alone).
 * WAITING_CUSTOMER -> IN_PROGRESS automatically.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { publicId: string } },
) {
  try {
    const ip = getClientIp(req);
    if (!(await rateLimit('support-msg-customer', `${params.publicId}:${ip}`, 20, 60_000))) {
      return err('RATE_LIMITED', 'Terlalu banyak pesan. Coba lagi nanti.', 429);
    }
    // Proven ownership FIRST, before parsing untrusted input.
    const session = await requireWalletSession(req, 'SUPPORT');
    const body = await readJsonBounded(req);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return err('INVALID_INPUT', parsed.error.issues[0]?.message ?? 'Input tidak valid.', 400);
    }
    const queryWallet = (req.nextUrl.searchParams.get('wallet') ?? '').trim();
    const claimed = (queryWallet || parsed.data.walletAddress || '').trim();
    // Proven ownership: only the session wallet may post to this ticket.
    if (claimed && !sameWallet(claimed, session.walletAddress)) {
      return err('WALLET_MISMATCH', 'Wallet sesi tidak cocok.', 403);
    }
    const wallet = session.walletAddress;
    // Format already proven at challenge time; session is authoritative.
    if (!(await rateLimit('support-msg-wallet', wallet.toLowerCase(), 20, 60_000))) {
      return err('RATE_LIMITED', 'Terlalu banyak pesan. Coba lagi nanti.', 429);
    }

    const ticket = await prisma.supportTicket.findUnique({
      where: { publicId: params.publicId },
    });
    if (!ticket) return err('TICKET_NOT_FOUND', 'Tiket tidak ditemukan.', 404);
    if (!sameWallet(ticket.walletAddress, wallet)) {
      return err('FORBIDDEN', 'Tiket ini bukan milik wallet Anda.', 403);
    }
    if (ticket.status === 'CLOSED') {
      return err('TICKET_CLOSED', 'Tiket sudah ditutup.', 400);
    }

    const text = parsed.data.message.trim();
    const autoStatus = nextStatusOnMessage(ticket.status, 'CUSTOMER');
    const now = new Date();
    const [msg] = await prisma.$transaction([
      prisma.supportMessage.create({
        data: { ticketId: ticket.id, senderType: 'CUSTOMER', message: text },
      }),
      prisma.supportTicket.update({
        where: { id: ticket.id },
        data: {
          lastMessageAt: now,
          adminUnread: { increment: 1 },
          ...(autoStatus ? { status: autoStatus } : {}),
        },
      }),
    ]);
    return ok({ message: { id: msg.id, senderType: msg.senderType, message: msg.message, createdAt: msg.createdAt } }, 201);
  } catch (e) {
    return handleError(e);
  }
}
