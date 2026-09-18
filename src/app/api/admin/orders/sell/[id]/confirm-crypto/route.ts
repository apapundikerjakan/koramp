import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/adminAuth';
import { prisma } from '@/lib/prisma';
import { getBlockchainProvider, type NetworkId } from '@/lib/blockchain';
import { processSellPayout } from '@/lib/orders';
import { ok, handleError } from '@/lib/response';
import { NotFoundError, AppError } from '@/lib/errors';
import { findIncomingTx, sameAddress } from '@/lib/blockchain/scan';

export const dynamic = 'force-dynamic';

// txHash is now optional — if omitted we scan the deposit address automatically
const schema = z.object({
  txHash: z.string().min(1).max(200).optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const admin = await requireAdmin(req);
    const { readJsonBounded } = await import('@/lib/apiGuard');
    const body = await schema.parseAsync(await readJsonBounded(req));

    const order = await prisma.sellOrder.findUnique({ where: { id: params.id } });
    if (!order) throw new NotFoundError('Order tidak ditemukan');

    if (!['AWAITING_CRYPTO', 'CRYPTO_DETECTED', 'CONFIRMING'].includes(order.status)) {
      throw new AppError(422, 'INVALID_ORDER_STATE',
        `Order tidak bisa dikonfirmasi. Status saat ini: ${order.status}`);
    }

    const bc = getBlockchainProvider(order.network as NetworkId);

    let txHash = body.txHash;
    let txInfo: import('@/lib/blockchain/types').TxInfo | null = null;

    if (txHash) {
      // Admin supplied a txHash — verify it directly
      txInfo = await bc.getTransaction(txHash);
      if (!txInfo) {
        throw new AppError(400, 'TX_NOT_FOUND', 'Transaksi tidak ditemukan di blockchain');
      }
    } else {
      // No txHash — scan deposit address with sender binding (P10).
      const found = await findIncomingTx({
        network: order.network as NetworkId,
        depositAddress: order.depositAddress,
        expectedAmount: order.cryptoAmount.toString(),
        asset: order.assetSymbol,
        expectedSender: order.walletAddress,
      });
      if (!found) {
        throw new AppError(404, 'TX_NOT_FOUND',
          'Belum ada transaksi yang terdeteksi di alamat deposit. Tunggu beberapa saat dan coba lagi.');
      }
      txHash = found.txHash;
      txInfo = found;
    }

    // Verify destination matches deposit address
    if (!sameAddress(txInfo.to, order.depositAddress)) {
      throw new AppError(422, 'WRONG_DESTINATION', 'Transaksi bukan ke alamat deposit order ini');
    }

    // Verify sender == order.walletAddress (P10 — prevents spoofing via shared wallet).
    if (!sameAddress(txInfo.from, order.walletAddress)) {
      throw new AppError(422, 'WRONG_SENDER',
        `Pengirim tidak sesuai: ${txInfo.from} != order wallet ${order.walletAddress}`);
    }

    // Verify txHash not reused by another sell order (P10).
    const reused = await prisma.sellOrder.findFirst({
      where: { cryptoTxHash: txHash, id: { not: order.id } },
      select: { id: true, publicId: true },
    });
    if (reused) {
      throw new AppError(422, 'TX_REUSED', `txHash sudah dipakai order ${reused.publicId}`);
    }

    const depositAddress = bc.getDepositAddress(order.publicId);
    if (depositAddress.includes('NOT_CONFIGURED') || depositAddress.includes('INVALID')) {
      throw new AppError(500, 'DEPOSIT_ADDR_ERROR', 'Deposit address tidak terkonfigurasi');
    }

    // Check confirmations
    const { getRequiredConfirmations } = await import('@/lib/validateWallet');
    const requiredConfs = getRequiredConfirmations(order.network as NetworkId, order.assetSymbol, order.requiredConfirmations);
    if (txInfo.confirmations < requiredConfs) {
      throw new AppError(422, 'NOT_ENOUGH_CONFIRMATIONS',
        `Transaksi perlu ${requiredConfs} konfirmasi, saat ini ${txInfo.confirmations}`);
    }

    // FAILED (§8): receipt gagal tidak bisa dikonfirmasi — jangan pernah simpan.
    if (txInfo.txStatus === 'FAILED' || txInfo.receiptStatus === 0) {
      throw new AppError(422, 'TX_FAILED', 'Transaksi GAGAL di blockchain (receipt status 0)');
    }

    // Verify amount — wei-exact (§7), bukan toleransi desimal blanket.
    const { weiEquals } = await import('@/lib/blockchain/scan');
    if (!(await weiEquals(txInfo.amount, order.cryptoAmount.toString()))) {
      throw new AppError(422, 'WRONG_AMOUNT',
        `Jumlah tidak sesuai: diterima ${txInfo.amount}, diharapkan ${order.cryptoAmount}`);
    }

    // Update order to CRYPTO_CONFIRMED
    await prisma.$transaction(async (tx) => {
      await tx.sellOrder.update({
        where: { id: params.id },
        data: { status: 'CRYPTO_CONFIRMED', cryptoTxHash: txHash },
      });
      await tx.auditLog.create({
        data: {
          action: 'ADMIN_CONFIRM_CRYPTO',
          entity: 'SellOrder',
          entityId: params.id,
          actor: `admin:${admin.adminId}`,
          metadata: JSON.stringify({
            txHash,
            txConfirmations: txInfo!.confirmations,
            txAmount: txInfo!.amount,
            expectedAmount: order.cryptoAmount.toString(),
            from: txInfo!.from,
            to: txInfo!.to,
            autoScanned: !body.txHash,
          }),
        },
      });
    });

    // Durable payout trigger (awaited; cron reconciles if needed — P14).
    try {
      await processSellPayout(params.id);
    } catch (err) {
      console.error('[ConfirmCrypto] Payout error (recoverable by cron):', err);
      await prisma.auditLog.create({
        data: {
          action: 'PAYOUT_FAILED',
          entity: 'SellOrder',
          entityId: params.id,
          actor: `admin:${admin.adminId}`,
          metadata: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
        },
      }).catch(console.error);
    }

    return ok({
      confirmed: true,
      txHash,
      confirmations: txInfo.confirmations,
      amount: txInfo.amount,
      autoScanned: !body.txHash,
    });
  } catch (err) {
    console.error('[AdminConfirmCrypto] Error:', err instanceof Error ? err.message : 'unknown');
    return handleError(err);
  }
}
