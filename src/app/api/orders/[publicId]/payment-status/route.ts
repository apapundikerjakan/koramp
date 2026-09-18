import { NextRequest } from 'next/server';
import type { Payment } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { verifyAndFulfillTopUp } from '@/lib/orders';
import { ok, handleError } from '@/lib/response';
import { NotFoundError } from '@/lib/errors';
import { guardPublic } from '@/lib/apiGuard';
import { qrVisibleForStatus } from '@/lib/privacy';

export const dynamic = 'force-dynamic';

/**
 * GET|POST /api/orders/[publicId]/payment-status
 *
 * Public-but-opaque-auth fallback for KiPay polling when webhook is delayed.
 * - authenticate by opaque publicId (order ownership is irrelevant; token is secret)
 * - locate local payment
 * - server-side GET KiPay transaction (throttled)
 * - verify trx_id + amount + mode
 * - update local payment/order idempotently
 * - trigger crypto delivery only once
 *
 * Never exposes API key. Rate limited. Bounded upstream calls.
 */
export async function GET(req: NextRequest, { params }: { params: { publicId: string } }) {
  return handlePaymentStatus(req, { params });
}

export async function POST(req: NextRequest, { params }: { params: { publicId: string } }) {
  return handlePaymentStatus(req, { params });
}

async function handlePaymentStatus(req: NextRequest, { params }: { params: { publicId: string } }) {
  try {
    const { publicId } = params;
    if (!publicId || publicId.length > 100) {
      throw new NotFoundError('Order tidak ditemukan');
    }

    // Per-order bucket (not global per-IP) — prevents rotating publicId to
    // amplify upstream KiPay GET calls.
    const g = await guardPublic(req, `payment-status:${publicId}`, 10, 60_000);
    if (g.response) {
      const status = g.response.status;
      if (status === 429) return ok({ status: 'RATE_LIMITED', message: 'Terlalu sering. Coba lagi nanti.' }, 429);
      return g.response;
    }

    const order = await prisma.topUpOrder.findUnique({
      where: { publicId },
      include: { payment: true },
    });

    if (!order || !order.payment) {
      throw new NotFoundError('Order tidak ditemukan');
    }

    // Only meaningful for orders still awaiting payment confirmation.
    if (!['CREATED', 'PAYMENT_PENDING', 'PAYMENT_CREATE_UNKNOWN'].includes(order.status)) {
      return ok({
        status: order.status,
        payment: order.payment ? paymentView(order.payment, order.status) : null,
      });
    }

    // throttleMs=5s — fast enough for polling UX, slow enough to not hammer KiPay.
    const result = await verifyAndFulfillTopUp(publicId, { throttleMs: 5000 });

    // Re-fetch order status after verification (it may have just been updated).
    const updatedOrder = await prisma.topUpOrder.findUnique({
      where: { publicId },
      select: { status: true },
    });
    const currentStatus = updatedOrder?.status ?? order.status;

    return ok({
      status: currentStatus,
      verified: result.state,
    });
  } catch (err) {
    return handleError(err);
  }
}

function paymentView(payment: Payment, orderStatus: string) {
  return {
    status: payment.status,
    kipayTrxId: payment.kipayTrxId,
    requestedAmount: payment.requestedAmount,
    uniqueCode: payment.uniqueCode,
    grossAmount: payment.grossAmount,
    feeAmount: payment.feeAmount,
    netAmount: payment.netAmount,
    provider: payment.provider,
    qrPayload: qrVisibleForStatus(orderStatus) ? payment.qrPayload : null,
    paidAt: payment.paidAt,
    expiresAt: payment.expiresAt,
  };
}
