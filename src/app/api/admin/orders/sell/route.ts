import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { prisma } from '@/lib/prisma';
import { ok, handleError } from '@/lib/response';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const url = new URL(req.url);
    const status = url.searchParams.get('status') ?? undefined;
    const search = url.searchParams.get('search')?.trim() ?? undefined;
    const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
    const limit = Math.min(50, parseInt(url.searchParams.get('limit') ?? '20', 10));

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
      prisma.sellOrder.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { deposit: true, payout: true },
      }),
      prisma.sellOrder.count({ where }),
    ]);

    return ok({ orders, total, page, limit });
  } catch (err) { return handleError(err); }
}
