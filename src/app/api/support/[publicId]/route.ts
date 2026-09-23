import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, handleError } from '@/lib/response';
import { EVM_RE, SOL_RE, sameWallet } from '@/lib/support';
import { guardPublic } from '@/lib/apiGuard';

export const dynamic = 'force-dynamic';

function err(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function getWallet(req: NextRequest, bodyWallet?: string): string {
  return (
    (req.nextUrl.searchParams.get('wallet') ?? (bodyWallet ?? '')).trim()
  );
}

/**
 * GET /api/support/[publicId]?wallet=0x...
 * Customer reads own ticket + messages. Marks ADMIN messages as read
 * (readAt) and resets customerUnread. Never exposes adminNote.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { publicId: string } },
) {
  try {
    const g = await guardPublic(req, 'support-read', 30);
    if (g.response) return g.response;
    const wallet = getWallet(req);
    if (!wallet) return err('WALLET_REQUIRED', 'Wallet address diperlukan.', 400);
    if (!EVM_RE.test(wallet) && !SOL_RE.test(wallet)) {
      return err('INVALID_WALLET_ADDRESS', 'Alamat wallet tidak valid.', 400);
    }
    const ticket = await prisma.supportTicket.findUnique({
      where: { publicId: params.publicId },
      include: {
        messages: { orderBy: { createdAt: 'asc' }, take: 200, select: { id: true, senderType: true, message: true, readAt: true, createdAt: true } },
      },
    });
    if (!ticket) return err('TICKET_NOT_FOUND', 'Tiket tidak ditemukan.', 404);
    if (!sameWallet(ticket.walletAddress, wallet)) {
      return err('FORBIDDEN', 'Tiket ini bukan milik wallet Anda.', 403);
    }
    // Mark as read by customer: ADMIN messages -> readAt, reset counter.
    const unreadAdminIds = ticket.messages
      .filter((m) => m.senderType === 'ADMIN' && !m.readAt)
      .map((m) => m.id);
    if (unreadAdminIds.length > 0 || ticket.customerUnread !== 0) {
      await prisma.$transaction([
        ...(unreadAdminIds.length
          ? [prisma.supportMessage.updateMany({ where: { id: { in: unreadAdminIds } }, data: { readAt: new Date() } })]
          : []),
        prisma.supportTicket.update({ where: { id: ticket.id }, data: { customerUnread: 0 } }),
      ]);
    }
    // Never expose adminNote, internal DB ids, or read receipts to customers.
    const { adminNote: _omit, id: _omitId, ...safe } = ticket as typeof ticket & { adminNote?: string | null };
    void _omit;
    void _omitId;
    const messages = ticket.messages.map((m) => ({ id: m.id, senderType: m.senderType, message: m.message, createdAt: m.createdAt }));
    return ok({ ticket: { ...safe, messages } });
  } catch (e) {
    return handleError(e);
  }
}
