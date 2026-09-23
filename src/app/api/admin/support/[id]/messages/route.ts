import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/adminAuth';
import { prisma } from '@/lib/prisma';
import { ok, handleError } from '@/lib/response';
import { readJsonBounded } from '@/lib/apiGuard';
import { SUPPORT_MESSAGE_MAX } from '@/lib/support';

export const dynamic = 'force-dynamic';

function err(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

const schema = z.object({
  message: z.string().trim().min(1, 'Pesan tidak boleh kosong.').max(SUPPORT_MESSAGE_MAX),
});

/**
 * GET /api/admin/support/[id]/messages?after=<iso>&take=
 * Lightweight polling: only messages newer than `after` (or latest 100).
 * Marks CUSTOMER messages read.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAdmin(req);
    const ticket = await prisma.supportTicket.findFirst({
      where: { OR: [{ id: params.id }, { publicId: params.id }] },
      select: { id: true, status: true, adminUnread: true },
    });
    if (!ticket) return err('TICKET_NOT_FOUND', 'Tiket tidak ditemukan.', 404);
    const sp = req.nextUrl.searchParams;
    const afterRaw = sp.get('after');
    const take = Math.min(Math.max(parseInt(sp.get('take') ?? '100', 10) || 100, 1), 200);
    const after = afterRaw ? new Date(afterRaw) : null;
    const messages = await prisma.supportMessage.findMany({
      where: {
        ticketId: ticket.id,
        ...(after && !isNaN(after.getTime()) ? { createdAt: { gt: after } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take,
    });
    // Mark customer messages read (recipient = admin just fetched them).
    const unreadIds = messages.filter((m) => m.senderType === 'CUSTOMER' && !m.readAt).map((m) => m.id);
    if (unreadIds.length > 0) {
      await prisma.$transaction([
        prisma.supportMessage.updateMany({ where: { id: { in: unreadIds } }, data: { readAt: new Date() } }),
        prisma.supportTicket.update({ where: { id: ticket.id }, data: { adminUnread: 0 } }),
      ]);
    }
    return ok({ messages, status: ticket.status });
  } catch (e) {
    return handleError(e);
  }
}

/**
 * POST /api/admin/support/[id]/messages — admin reply.
 * OPEN -> IN_PROGRESS automatically. Never accepts sender identity from body.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAdmin(req);
    const body = await readJsonBounded(req);
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw parsed.error;
    const ticket = await prisma.supportTicket.findFirst({
      where: { OR: [{ id: params.id }, { publicId: params.id }] },
    });
    if (!ticket) return err('TICKET_NOT_FOUND', 'Tiket tidak ditemukan.', 404);
    if (ticket.status === 'CLOSED') {
      return err('TICKET_CLOSED', 'Tiket sudah ditutup.', 400);
    }
    const text = parsed.data.message.trim();
    const autoStatus = ticket.status === 'OPEN' ? 'IN_PROGRESS' : null;
    const now = new Date();
    const [msg] = await prisma.$transaction([
      prisma.supportMessage.create({
        data: { ticketId: ticket.id, senderType: 'ADMIN', message: text },
      }),
      prisma.supportTicket.update({
        where: { id: ticket.id },
        data: {
          lastMessageAt: now,
          customerUnread: { increment: 1 },
          ...(autoStatus ? { status: autoStatus } : {}),
        },
      }),
    ]);
    try {
      await prisma.auditLog.create({
        data: { action: 'SUPPORT_ADMIN_REPLY', entity: 'SupportTicket', entityId: ticket.publicId, actor: 'admin' },
      });
    } catch {}
    return ok({ message: { id: msg.id, senderType: msg.senderType, message: msg.message, createdAt: msg.createdAt } }, 201);
  } catch (e) {
    return handleError(e);
  }
}
