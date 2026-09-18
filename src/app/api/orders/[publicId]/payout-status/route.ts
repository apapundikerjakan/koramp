/**
 * GET /api/orders/:publicId/payout-status
 * Returns the current payout status and proof fields for a sell order.
 * Used by the sell page to poll for COMPLETED and show receipt.
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, handleError } from '@/lib/response';
import { NotFoundError } from '@/lib/errors';
import { guardPublic } from '@/lib/apiGuard';
import { maskAccount } from '@/lib/privacy';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { publicId: string } },
) {
  try {
    const g = await guardPublic(req, `payout-status:${params.publicId}`, 30, 60_000);
    if (g.response) return g.response;
    const order = await prisma.sellOrder.findUnique({
      where: { publicId: params.publicId },
      include: {
        payout: {
          select: {
            status: true,
            bankName: true,
            accountNumber: true,
            accountName: true,
            amount: true,
            providerRef: true,
            sentAt: true,
            completedAt: true,
            failureReason: true,
          },
        },
      },
    });

    if (!order) throw new NotFoundError('Order tidak ditemukan');

    return ok({
      status: order.status,
      completedAt: order.completedAt,
      payout: order.payout
        ? {
            status: order.payout.status,
            bankName: order.payout.bankName,
            // Mask account number — show last 4 digits only
            accountNumber: maskAccount(order.payout.accountNumber),
            accountName: order.payout.accountName,
            amount: order.payout.amount,
            providerRef: order.payout.providerRef,
            sentAt: order.payout.sentAt,
            completedAt: order.payout.completedAt,
            failureReason: order.payout.failureReason,
          }
        : null,
    });
  } catch (err) { return handleError(err); }
}
