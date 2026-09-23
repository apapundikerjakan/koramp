import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { prisma } from '@/lib/prisma';
import { ok, handleError } from '@/lib/response';
import { SUPPORT_STATUSES } from '@/lib/support';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/support?status=&q=&take=&cursor=
 * Server-side filter + search (ticket publicId, wallet, order, subject).
 * Returns tickets with last message + pendingCount (OPEN + IN_PROGRESS).
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const sp = req.nextUrl.searchParams;
    const rawStatus = (sp.get('status') ?? '').toUpperCase();
    const q = (sp.get('q') ?? '').trim().slice(0, 100);
    const take = Math.min(Math.max(parseInt(sp.get('take') ?? '50', 10) || 50, 1), 100);
    const cursor = sp.get('cursor') ?? undefined;

    const statusFilter =
      (SUPPORT_STATUSES as readonly string[]).includes(rawStatus) ? rawStatus : undefined;

    const where: Record<string, unknown> = {};
    if (statusFilter) where.status = statusFilter;
    if (q) {
      where.OR = [
        { publicId: { contains: q } },
        { walletAddress: { contains: q } },
        { orderPublicId: { contains: q } },
        { subject: { contains: q } },
      ];
    }

    const [tickets, pendingCount] = await Promise.all([
      prisma.supportTicket.findMany({
        where,
        orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
        take: take + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: {
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      }),
      prisma.supportTicket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
    ]);

    const hasMore = tickets.length > take;
    const page = hasMore ? tickets.slice(0, take) : tickets;
    return ok({
      tickets: page,
      pendingCount,
      nextCursor: hasMore ? page[page.length - 1].id : null,
    });
  } catch (err) {
    return handleError(err);
  }
}
