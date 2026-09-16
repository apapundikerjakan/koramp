import { NextRequest } from 'next/server';
import type { Payment } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { verifyAndFulfillTopUp } from '@/lib/orders';
import { ok, handleError } from '@/lib/response';
import { NotFoundError } from '@/lib/errors';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rateLimit';

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

async function handlePaymentStatus(_req: NextRequest, { params }: { params: { publicId: string } }) {
  try {
    const { publicId } = params;
    if (!publicId || publicId.length > 100) {
      throw new NotFoundError('Order tidak ditemukan');
    }

    const ip = getClientIp(_req);
    if (!rateLimit('order-payment-status', ip, RATE_LIMITS.public.max, RATE_LIMITS.public.windowMs)) {
      return ok({ status: 'RATE_LIMITED', message: 'Terlalu sering. Coba lagi nanti.' }, 429);
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
    qrPayload: ['PAYMENT_PENDING', 'CREATED', 'PAYMENT_CREATE_UNKNOWN'].includes(orderStatus) ? payment.qrPayload : null,
    paidAt: payment.paidAt,
    expiresAt: payment.expiresAt,
  };
}
