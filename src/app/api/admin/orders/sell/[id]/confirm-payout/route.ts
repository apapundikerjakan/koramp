/**
 * POST /api/admin/orders/sell/:id/confirm-payout
 *
 * Admin manually confirms that IDR payout has been sent to the user.
 * Used in production when a real disbursement provider is not yet integrated,
 * or as a manual override.
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/adminAuth';
import { prisma } from '@/lib/prisma';
import { completeSellPayout } from '@/lib/orders';
import { ok, handleError } from '@/lib/response';
import { NotFoundError, AppError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const schema = z.object({
  providerRef: z.string().max(200).optional(),
  notes: z.string().max(500).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const admin = await requireAdmin(req);
    const body = await schema.parseAsync(await req.json());

    const order = await prisma.sellOrder.findUnique({
      where: { id: params.id },
      include: { payout: true },
    });
    if (!order) throw new NotFoundError('Order tidak ditemukan');

    if (!['PAYOUT_PROCESSING', 'PAYOUT_FAILED'].includes(order.status)) {
      throw new AppError(
        422,
        'INVALID_ORDER_STATE',
        `Order tidak bisa dikonfirmasi payout. Status saat ini: ${order.status}`,
      );
    }

    const providerRef = body.providerRef ?? `MANUAL-${admin.adminId.slice(0, 8)}-${Date.now()}`;

    await completeSellPayout(order.id, providerRef);

    // Extra audit entry for manual confirmation
    await prisma.auditLog.create({
      data: {
        action: 'ADMIN_CONFIRM_PAYOUT',
        entity: 'SellOrder',
        entityId: order.id,
        actor: `admin:${admin.adminId}`,
        metadata: JSON.stringify({
          providerRef,
          notes: body.notes,
          bankName: order.payoutBankName,
          accountNumber: order.payoutAccountNumber?.slice(-4),
          amount: order.totalIdrPayout.toString(),
        }),
      },
    });

    return ok({
      confirmed: true,
      providerRef,
      status: 'COMPLETED',
    });
  } catch (err) {
    console.error('[AdminConfirmPayout] error:', err);
    return handleError(err);
  }
}
