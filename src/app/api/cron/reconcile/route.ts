/**
 * GET /api/cron/reconcile
 * Durable job reconciler (P14).
 *
 * Resumes financial operations stuck in intermediate states after process
 * termination (serverless fire-and-forget recovery):
 *  - TopUp CRYPTO_PROCESSING with BROADCASTED/CONFIRMING withdrawal → re-check confirmation
 *  - TopUp PAYMENT_CONFIRMED older than 1 min → resume delivery
 *  - Sell CRYPTO_CONFIRMED without payout / PAYOUT_PROCESSING → resume payout intent
 *
 * Auth: CRON_SECRET bearer when configured.
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getBlockchainProvider, type NetworkId } from '@/lib/blockchain';
import { processCryptoDelivery, processSellPayout, verifyAndFulfillPayout } from '@/lib/orders';
import { ok } from '@/lib/response';
import { guardCron } from '@/lib/apiGuard';

export const dynamic = 'force-dynamic';

// Overlap guard (§24): satu proses satu eksekusi (lihat scan-deposits).
let running = false;

export async function GET(req: NextRequest) {
  const denied = guardCron(req);
  if (denied) return denied;
  if (running) {
    // eslint-disable-next-line no-console
    console.info(JSON.stringify({ scope: 'cron', event: 'reconcile_skipped_overlap' }));
    return ok({ ok: false, error: 'overlapping' });
  }
  running = true;
  const t0 = Date.now();
  // eslint-disable-next-line no-console
  console.info(JSON.stringify({ scope: 'cron', event: 'reconcile_started' }));
  try {
    return ok({ ok: true, ...(await runReconcile()) });
  } finally {
    running = false;
    // eslint-disable-next-line no-console
    console.info(JSON.stringify({ scope: 'cron', event: 'reconcile_completed', durationMs: Date.now() - t0 }));
  }
}

async function runReconcile() {

  const out: Record<string, number> = { resumedDeliveries: 0, confirmedDeliveries: 0, resumedPayouts: 0, purgedEvents: 0 };

  // 0. Security retention purge (bounded tables, no indefinite growth).
  try {
    const { purgeOldSecurityData } = await import('@/lib/security');
    const purged = await purgeOldSecurityData();
    out.purgedEvents = purged.events;
  } catch {
    // never fail financial reconcile on security housekeeping
  }

  // 1. TopUp stuck in CRYPTO_PROCESSING — re-check withdrawal confirmation.
  // Xendit BUY orders use KORAMP delivery — resume them here.
  const stuckTopups = await prisma.topUpOrder.findMany({
    where: { status: 'CRYPTO_PROCESSING' },
    include: { withdrawal: true, payment: { select: { provider: true } } },
    take: 20,
  });
  for (const o of stuckTopups) {
    try {
      if (o.withdrawal?.txHash) {
        const bc = getBlockchainProvider(o.network as NetworkId);
        const info = await bc.getTransaction(o.withdrawal.txHash).catch(() => null);
        if (info?.isConfirmed) {
          await prisma.$transaction(async (tx) => {
            await tx.cryptoWithdrawal.update({
              where: { topUpOrderId: o.id },
              data: { status: 'CONFIRMED', confirmedAt: new Date() },
            });
            await tx.topUpOrder.update({
              where: { id: o.id },
              data: { status: 'COMPLETED', cryptoTxHash: o.withdrawal!.txHash!, completedAt: new Date() },
            });
          });
          out.confirmedDeliveries++;
          continue;
        }
      }
      // Resume delivery state machine (idempotent, no double-send).
      await processCryptoDelivery(o.id);
      out.resumedDeliveries++;
    } catch (e) {
      console.error('[cron/reconcile] topup error:', o.publicId, e);
    }
  }

  // 2. PAYMENT_CONFIRMED never started delivery (webhook process died before delivery).
  // Xendit path — resume KORAMP crypto delivery.
  const neverStarted = await prisma.topUpOrder.findMany({
    where: { status: 'PAYMENT_CONFIRMED' },
    include: { payment: { select: { provider: true } } },
    take: 20,
  });
  for (const o of neverStarted) {
    try {
      await processCryptoDelivery(o.id);
      out.resumedDeliveries++;
    } catch (e) {
      console.error('[cron/reconcile] payment_confirmed error:', o.publicId, e);
    }
  }

  // 2b. PAYMENT_CREATE_UNKNOWN stuck too long -> expire so user can safely retry.
  const unknownOrders = await prisma.topUpOrder.findMany({
    where: { status: 'PAYMENT_CREATE_UNKNOWN', expiresAt: { lt: new Date(Date.now() - 30 * 60 * 1000) } },
    take: 20,
  });
  for (const o of unknownOrders) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.payment.update({
          where: { topUpOrderId: o.id },
          data: { status: 'FAILED' },
        }).catch(() => {});
        await tx.topUpOrder.update({
          where: { id: o.id },
          data: { status: 'PAYMENT_CREATE_FAILED', failureReason: 'Status pembayaran tidak bisa ditentukan. Buat order baru.' },
        });
      });
      out.resumedDeliveries++;
    } catch (e) {
      console.error('[cron/reconcile] payment_create_unknown error:', o.publicId, e);
    }
  }

  // 3. Sell payouts stuck.
  const stuckSells = await prisma.sellOrder.findMany({
    where: { status: { in: ['CRYPTO_CONFIRMED', 'PAYOUT_PROCESSING'] } },
    include: { payout: true },
    take: 20,
  });
  for (const o of stuckSells) {
    try {
      // processSellPayout is idempotent via payout upsert on sellOrderId.
      if (o.status === 'CRYPTO_CONFIRMED' && !o.payout?.xenditPayoutId) {
        await processSellPayout(o.id);
        out.resumedPayouts++;
      } else if (o.payout?.xenditPayoutId) {
        // Payout exists — reconcile server-side (webhook may be delayed).
        await verifyAndFulfillPayout(o.id);
        out.resumedPayouts++;
      }
    } catch (e) {
      console.error('[cron/reconcile] sell error:', o.publicId, e);
    }
  }

  return { ...out };
}
