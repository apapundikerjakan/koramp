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
 * Public-but-opaque-auth fallback for Xendit polling when webhook is delayed.
 * - authenticate by opaque publicId (order ownership is irrelevant; token is secret)
 * - locate local payment
 * - server-side GET Xendit payment request (throttled)
 * - verify reference_id + amount + currency + channel
 * - update local payment/order idempotently
 * - SUCCEEDED → PAYMENT_CONFIRMED → KORAMP crypto delivery resumes
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
    // amplify upstream Xendit GET calls.
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
    if (!['CREATED', 'PAYMENT_PENDING', 'PAYMENT_CREATE_UNKNOWN', 'PAYMENT_CONFIRMED', 'CRYPTO_PROCESSING'].includes(order.status)) {
      return ok({
        status: order.status,
        payment: order.payment ? paymentView(order.payment, order.status) : null,
      });
    }

    // throttleMs=15s — cocok dengan default lib (15000): upstream Xendit
    // maksimal ~4x/menit per order. Polling client lebih cepat dari ini
    // dilayani dari DB (fast path) tanpa menyentuh upstream.
    const result = await verifyAndFulfillTopUp(publicId, { throttleMs: 15000 });

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
    provider: payment.provider,
    providerOrderId: payment.providerOrderId,
    providerStatus: payment.providerStatus,
    requestedAmount: payment.requestedAmount,
    uniqueCode: payment.uniqueCode,
    grossAmount: payment.grossAmount,
    feeAmount: payment.feeAmount,
    netAmount: payment.netAmount,
    payUrl: payment.payUrl,
    qrPayload: qrVisibleForStatus(orderStatus) ? payment.qrPayload : null,
    paidAt: payment.paidAt,
    expiresAt: payment.expiresAt,
  };
}
