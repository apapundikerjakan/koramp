import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/adminAuth';
import { prisma } from '@/lib/prisma';
import { ok, handleError } from '@/lib/response';
import { readJsonBounded } from '@/lib/apiGuard';

export const dynamic = 'force-dynamic';

const schema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED']),
  adminNote: z.string().max(2000).optional(),
});

/**
 * GET /api/admin/support/[id] — ticket detail + messages + live order context.
 * Marks CUSTOMER messages as read and resets adminUnread.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAdmin(req);
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: params.id },
      include: { messages: { orderBy: { createdAt: 'asc' }, take: 500 } },
    });
    if (!ticket) {
      const byPublic = await prisma.supportTicket.findUnique({
        where: { publicId: params.id },
        include: { messages: { orderBy: { createdAt: 'asc' }, take: 500 } },
      });
      if (!byPublic) return ok({ ticket: null }, 404);
      return ok({ ticket: await markRead(byPublic) });
    }
    return ok({ ticket: await markRead(ticket) });
  } catch (err) {
    return handleError(err);
  }
}

type TicketWithMessages = {
  id: string;
  orderPublicId: string | null;
  adminUnread: number;
  messages: { id: string; senderType: string; readAt: Date | null }[];
};

async function markRead<T extends TicketWithMessages>(ticket: T): Promise<T> {
  const unreadIds = ticket.messages
    .filter((m) => m.senderType === 'CUSTOMER' && !m.readAt)
    .map((m) => m.id);
  if (unreadIds.length === 0 && ticket.adminUnread === 0) return ticket;
  await prisma.$transaction([
    ...(unreadIds.length
      ? [prisma.supportMessage.updateMany({ where: { id: { in: unreadIds } }, data: { readAt: new Date() } })]
      : []),
    prisma.supportTicket.update({ where: { id: ticket.id }, data: { adminUnread: 0 } }),
  ]);
  return ticket;
}

/** PATCH /api/admin/support/[id] — update ticket status/note (admin only). */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAdmin(req);
    const body = await readJsonBounded(req);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw parsed.error;
    }
    const where = { id: params.id };
    // Allow publicId as well for convenience.
    const exists = await prisma.supportTicket.findUnique({ where });
    const key = exists ? where : { publicId: params.id };
    const ticket = await prisma.supportTicket.update({
      where: key,
      data: { status: parsed.data.status, adminNote: parsed.data.adminNote ?? undefined },
    });
    try {
      await prisma.auditLog.create({
        data: { action: 'SUPPORT_STATUS_CHANGED', entity: 'SupportTicket', entityId: ticket.publicId, actor: 'admin', metadata: JSON.stringify({ status: ticket.status }) },
      });
    } catch {}
    return ok({ ticket });
  } catch (err) {
    return handleError(err);
  }
}
