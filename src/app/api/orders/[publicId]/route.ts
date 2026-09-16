import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, handleError } from '@/lib/response';
import { NotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

// Public order status — no auth needed, uses opaque publicId
export async function GET(_req: NextRequest, { params }: { params: { publicId: string } }) {
  try {
    const { publicId } = params;

    // Try top up
    const topUp = await prisma.topUpOrder.findUnique({
      where: { publicId },
      include: {
        payment: { select: { status: true, requestedAmount: true, uniqueCode: true, grossAmount: true, feeAmount: true, netAmount: true, qrPayload: true, kipayTrxId: true, kipayMode: true, expiresAt: true, paidAt: true, provider: true } },
        withdrawal: { select: { txHash: true, status: true, sentAt: true } },
        quote: { select: { cryptoAmount: true, totalIdr: true, marketPrice: true, serviceFee: true, networkFee: true } },
      },
    });

    if (topUp) {
      // Strip sensitive internal data — only expose what user needs
      return ok({
        type: 'TOP_UP',
        publicId: topUp.publicId,
        orderNumber: topUp.orderNumber,
        walletAddress: topUp.walletAddress,
        asset: topUp.assetSymbol,
        network: topUp.network,
        idrAmount: topUp.idrAmount,
        cryptoAmount: topUp.cryptoAmount,
        totalIdr: topUp.totalIdr,
        serviceFee: topUp.serviceFee,
        networkFee: topUp.networkFee,
        tax: topUp.tax,
        destinationAddress: topUp.destinationAddress,
        status: topUp.status,
        failureReason: topUp.failureReason,
        cryptoTxHash: topUp.cryptoTxHash,
        completedAt: topUp.completedAt,
        expiresAt: topUp.expiresAt,
        createdAt: topUp.createdAt,
        payment: topUp.payment
          ? {
              status: topUp.payment.status,
              kipayTrxId: topUp.payment.kipayTrxId,
              requestedAmount: topUp.payment.requestedAmount,
              uniqueCode: topUp.payment.uniqueCode,
              grossAmount: topUp.payment.grossAmount,
              feeAmount: topUp.payment.feeAmount,
              netAmount: topUp.payment.netAmount,
              provider: topUp.payment.provider,
              qrPayload: topUp.status === 'PAYMENT_PENDING' || topUp.status === 'CREATED' || topUp.status === 'PAYMENT_CREATE_UNKNOWN'
                ? topUp.payment.qrPayload
                : null,
              paidAt: topUp.payment.paidAt,
              expiresAt: topUp.payment.expiresAt,
            }
          : null,
        withdrawal: topUp.withdrawal,
      });
    }

    // Try sell
    const sell = await prisma.sellOrder.findUnique({
      where: { publicId },
      include: {
        deposit: { select: { txHash: true, confirmations: true, isConfirmed: true, detectedAt: true } },
        payout: { select: { status: true, sentAt: true, completedAt: true } },
        quote: { select: { cryptoAmount: true, totalIdr: true, marketPrice: true, serviceFee: true, networkFee: true } },
      },
    });

    if (sell) {
      return ok({
        type: 'SELL',
        publicId: sell.publicId,
        orderNumber: sell.orderNumber,
        walletAddress: sell.walletAddress,
        asset: sell.assetSymbol,
        network: sell.network,
        cryptoAmount: sell.cryptoAmount,
        idrAmount: sell.idrAmount,
        totalIdrPayout: sell.totalIdrPayout,
        serviceFee: sell.serviceFee,
        networkFee: sell.networkFee,
        tax: sell.tax,
        depositAddress: sell.depositAddress,
        payoutBankName: sell.payoutBankName,
        // Mask account number for security
        payoutAccountNumber: sell.payoutAccountNumber
          ? `****${sell.payoutAccountNumber.slice(-4)}`
          : null,
        payoutAccountName: sell.payoutAccountName,
        status: sell.status,
        failureReason: sell.failureReason,
        cryptoTxHash: sell.cryptoTxHash,
        confirmations: sell.confirmations,
        requiredConfirmations: sell.requiredConfirmations,
        completedAt: sell.completedAt,
        expiresAt: sell.expiresAt,
        createdAt: sell.createdAt,
        deposit: sell.deposit,
        payout: sell.payout,
      });
    }

    throw new NotFoundError('Order tidak ditemukan');
  } catch (err) { return handleError(err); }
}
