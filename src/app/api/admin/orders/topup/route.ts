import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { prisma } from '@/lib/prisma';
import { ok, handleError } from '@/lib/response';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const url = new URL(req.url);
    const { parsePagination, TopUpStatusEnum } = await import('@/lib/schemas');
    const { page, limit } = parsePagination(url.searchParams);
    const rawStatus = url.searchParams.get('status') ?? undefined;
    const status = rawStatus && TopUpStatusEnum.safeParse(rawStatus).success ? rawStatus : undefined;
    const search = url.searchParams.get('search')?.trim().slice(0, 100) ?? undefined;

    // Build where clause — status filter + optional text search
    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { orderNumber: { contains: search } },
        { publicId:    { contains: search } },
        { walletAddress: { contains: search } },
      ];
    }

    const [orders, total] = await Promise.all([
      prisma.topUpOrder.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          payment: { select: { status: true, kipayTrxId: true, grossAmount: true } },
        },
      }),
      prisma.topUpOrder.count({ where }),
    ]);

    return ok({ orders, total, page, limit });
  } catch (err) { return handleError(err); }
}
