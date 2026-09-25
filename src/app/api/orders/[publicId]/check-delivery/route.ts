import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getBlockchainProvider, type NetworkId } from '@/lib/blockchain';
import { ok, handleError } from '@/lib/response';
import { NotFoundError } from '@/lib/errors';
import { guardPublic } from '@/lib/apiGuard';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/orders/[publicId]/check-delivery
 *
 * Re-checks the on-chain confirmation status of a CRYPTO_PROCESSING top-up order.
 * Called by the frontend polling loop when stuck in CRYPTO_PROCESSING.
 *
 * - Idempotent: safe to call repeatedly.
 * - Only transitions CRYPTO_PROCESSING → COMPLETED (never re-broadcasts).
 * - Rate limited: 6 req/min per IP.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { publicId: string } },
) {
  try {
    const { publicId } = params;
    const g = await guardPublic(req, `check-delivery:${publicId}`, 6, 60_000);
    if (g.response) {
      if (g.response.status === 429) return ok({ status: 'RATE_LIMITED' }, 429);
      return g.response;
    }
    if (!publicId || publicId.length > 100) throw new NotFoundError('Order tidak ditemukan');

    const order = await prisma.topUpOrder.findUnique({
      where: { publicId },
      include: { withdrawal: true, payment: { select: { provider: true } } },
    });

    if (!order) throw new NotFoundError('Order tidak ditemukan');

    // Xendit BUY orders ARE delivered by KORAMP — resume delivery below.

    // Only act on orders that are still processing crypto.
    if (order.status === 'COMPLETED') {
      return ok({ status: 'COMPLETED', alreadyDone: true });
    }
    if (order.status !== 'CRYPTO_PROCESSING') {
      return ok({ status: order.status });
    }

    const txHash = order.cryptoTxHash ?? order.withdrawal?.txHash;
    if (!txHash) {
      // No txHash yet — delivery hasn't broadcasted. Trigger processCryptoDelivery.
      const { processCryptoDelivery } = await import('@/lib/orders');
      await processCryptoDelivery(order.id);
      const refreshed = await prisma.topUpOrder.findUnique({
        where: { id: order.id },
        select: { status: true, cryptoTxHash: true },
      });
      return ok({ status: refreshed?.status ?? order.status, txHash: refreshed?.cryptoTxHash });
    }

    // Check confirmation on-chain.
    const bc = getBlockchainProvider(order.network as NetworkId);
    const txInfo = await bc.getTransaction(txHash).catch(() => null);

    if (txInfo?.isConfirmed) {
      // Transition to COMPLETED atomically.
      await prisma.$transaction(async (tx) => {
        if (order.withdrawal?.id) {
          await tx.cryptoWithdrawal.update({
            where: { topUpOrderId: order.id },
            data: { status: 'CONFIRMED', confirmedAt: new Date() },
          });
        }
        await tx.topUpOrder.update({
          where: { id: order.id },
          data: {
            status: 'COMPLETED',
            cryptoTxHash: txHash,
            completedAt: new Date(),
          },
        });
        await tx.auditLog.create({
          data: {
            action: 'CRYPTO_CONFIRMED',
            entity: 'TopUpOrder',
            entityId: order.id,
            actor: 'system',
            metadata: JSON.stringify({ txHash, confirmations: txInfo.confirmations }),
          },
        });
      });
      return ok({ status: 'COMPLETED', txHash, confirmations: txInfo.confirmations });
    }

    // Still waiting for confirmations.
    return ok({
      status: 'CRYPTO_PROCESSING',
      txHash,
      confirmations: txInfo?.confirmations ?? 0,
      found: txInfo !== null,
    });
  } catch (err) {
    return handleError(err);
  }
}
