import Decimal from 'decimal.js';
import type { KipayTransaction } from './kipay';
import { prisma } from './prisma';
import { validateAndUseQuote, AssetSymbol, NetworkId, validateAssetNetwork } from './pricing';
import { getBlockchainProvider, type BlockchainProvider } from './blockchain';
import { kipayCreateTransaction, kipayGetTransaction, KiPayError } from './kipay';
import { generatePublicId, generateOrderNumber } from './id';
import { AppError, ValidationError } from './errors';

function requiredConfirmations(asset: string): number {
  // Testnet: low confirmations for fast testing
  // Production: SOL=32, ETH(Base)=12, BNB(BSC)=15
  if (process.env.NODE_ENV !== 'production') {
    return asset === 'SOL' ? 5 : 3;
  }
  return asset === 'SOL' ? 32 : asset === 'ETH' ? 12 : 15;
}

// ─── TOP UP ───────────────────────────────────────────────────────────────────

export async function createTopUpOrder(opts: {
  walletAddress: string;
  walletType: 'EVM' | 'SOLANA';
  quoteId: string;
  asset: AssetSymbol;
  network: NetworkId;
}) {
  validateAssetNetwork(opts.asset, opts.network);

  // Validate wallet address format
  const bc = getBlockchainProvider(opts.network);
  if (!bc.isValidAddress(opts.walletAddress)) {
    throw new ValidationError(`Alamat wallet tidak valid untuk jaringan ${opts.network}`);
  }

  const quote = await validateAndUseQuote(opts.quoteId, 'TOP_UP');
  const orderNumber = generateOrderNumber();
  const publicId = generatePublicId('krp');
  const orderExpiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 min

  // Order + payment DIBUAT DULU (recoverable §9/§27) — KiPay menyusul.
  // Quote tetap dikonsumsi atomik di atas (anti double-spend via reuse).
  const order = await prisma.topUpOrder.create({
    data: {
      publicId, orderNumber,
      walletAddress: opts.walletAddress,
      walletType: opts.walletType,
      assetId: quote.assetId,
      assetSymbol: quote.assetSymbol,
      network: quote.network,
      quoteId: quote.id,
      idrAmount: quote.idrAmount,
      cryptoAmount: quote.cryptoAmount,
      serviceFee: quote.serviceFee,
      networkFee: quote.networkFee,
      tax: quote.tax,
      totalIdr: quote.totalIdr,
      destinationAddress: opts.walletAddress,
      status: 'PAYMENT_CREATING',
      expiresAt: orderExpiresAt,
    },
  });
  const payment = await prisma.payment.create({
    data: {
      topUpOrderId: order.id,
      status: 'CREATED',
      requestedAmount: new Decimal(quote.totalIdr.toString()).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber(),
      grossAmount: new Decimal(quote.totalIdr.toString()).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber(),
      expiresAt: orderExpiresAt,
    },
  });

  // Create KiPay transaction for QRIS — Decimal rounding, never float (P23).
  const idrInt = new Decimal(quote.totalIdr.toString()).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  let kipayTx;
  try {
    kipayTx = await kipayCreateTransaction({
      amount: idrInt,
      note: orderNumber,
    });
  } catch (e) {
    // Gagal deterministik (400/404) → FAILED, user buat order baru (tanpa retry).
    // Ambigu (timeout/5xx) → UNKNOWN, JANGAN buat transaksi kedua (§10);
    // reconcile men-expire-nya agar user bisa buat order baru dengan aman.
    const isUnknown = e instanceof KiPayError && (e.category === 'UNKNOWN' || e.category === 'TRANSIENT');
    const safeCategory = e instanceof KiPayError ? e.category : 'UNKNOWN';
    const failExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const recovered = await prisma.$transaction(async (tx) => {
      const failedPayment = await tx.payment.update({
        where: { id: payment.id },
        data: { status: isUnknown ? 'UNKNOWN' : 'FAILED', expiresAt: failExpiresAt },
      });
      const failedOrder = await tx.topUpOrder.update({
        where: { id: order.id },
        data: {
          status: isUnknown ? 'PAYMENT_CREATE_UNKNOWN' : 'PAYMENT_CREATE_FAILED',
          failureReason: isUnknown
            ? 'Pembayaran tidak dapat dipastikan — buat order baru.'
            : 'Layanan pembayaran tidak tersedia — buat order baru.',
          expiresAt: failExpiresAt,
        },
      });
      await tx.auditLog.create({
        data: {
          action: 'PAYMENT_CREATE_FAILED', entity: 'TopUpOrder', entityId: order.id,
          actor: order.walletAddress,
          metadata: JSON.stringify({ unknown: isUnknown, category: safeCategory }),
        },
      });
      return { order: failedOrder, payment: failedPayment };
    });
    return {
      ...recovered,
      kipayTrxId: null,
      paymentCreation: {
        state: isUnknown ? 'UNKNOWN' : 'FAILED',
        message: 'Layanan pembayaran sedang tidak tersedia. Silakan coba lagi.',
      },
    };
    throw new AppError(
      503, 'PAYMENT_PROVIDER_UNAVAILABLE',
      isUnknown
        ? 'Status pembayaran tidak pasti, jangan bayar apa pun. Silakan buat order baru.'
        : 'Layanan pembayaran gangguan, coba lagi.',
    );
  }

  // Store KiPay response ke payment record
  const updatedPayment = await prisma.payment.update({
    where: { id: payment.id },
    data: {
      kipayTrxId: kipayTx.trx_id,
      kipayMode: kipayTx.mode,
      requestedAmount: kipayTx.requested_amount,
      uniqueCode: kipayTx.unique_code,
      grossAmount: kipayTx.amount,
      feeAmount: kipayTx.fee_amount,
      // net_amount not returned by create/get in KiPay v1.2.0 (only in webhook)
      status: 'PENDING',
      // qr_payload not in JSON response v1.2.0 — QR fetched via GET /qr.png
      note: kipayTx.note,
      expiresAt: new Date(kipayTx.expires_at ?? orderExpiresAt.toISOString()),
      lastVerifiedAt: new Date(),
    },
  });

  await prisma.topUpOrder.update({
    where: { id: order.id },
    data: { status: 'PAYMENT_PENDING' },
  });

  return { order, payment: updatedPayment, kipayTrxId: kipayTx.trx_id };
}

// ─── SELL ─────────────────────────────────────────────────────────────────────

export async function createSellOrder(opts: {
  walletAddress: string;
  walletType: 'EVM' | 'SOLANA';
  quoteId: string;
  asset: AssetSymbol;
  network: NetworkId;
  bankName: string;
  accountNumber: string;
  accountName: string;
}) {
  validateAssetNetwork(opts.asset, opts.network);

  // Defense-in-depth: validate wallet address format here too (route also validates).
  const bc = getBlockchainProvider(opts.network);
  if (!bc.isValidAddress(opts.walletAddress)) {
    throw new ValidationError(`Alamat wallet tidak valid untuk jaringan ${opts.network}`);
  }

  const quote = await validateAndUseQuote(opts.quoteId, 'SELL');
  const orderNumber = generateOrderNumber();
  const publicId = generatePublicId('krs');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  // Get deposit address from platform wallet
  const depositAddress = bc.getDepositAddress(publicId);

  // Find platform wallet for this network
  const network = await prisma.network.findUnique({ where: { networkId: opts.network } });
  if (!network) throw new AppError(500, 'NO_NETWORK', `Network ${opts.network} tidak ditemukan`);

  const platformWallet = await prisma.platformWallet.findFirst({
    where: { networkId: network.id, isActive: true },
  });
  if (!platformWallet) throw new AppError(503, 'NO_WALLET', 'Platform wallet tidak tersedia');

  const order = await prisma.$transaction(async (tx) => {
    const newOrder = await tx.sellOrder.create({
      data: {
        publicId, orderNumber,
        walletAddress: opts.walletAddress,
        walletType: opts.walletType,
        assetId: quote.assetId,
        assetSymbol: quote.assetSymbol,
        network: quote.network,
        quoteId: quote.id,
        cryptoAmount: quote.cryptoAmount,
        idrAmount: quote.idrAmount,
        serviceFee: quote.serviceFee,
        networkFee: quote.networkFee,
        tax: quote.tax,
        totalIdrPayout: quote.totalIdr,
        depositAddress,
        payoutBankName: opts.bankName,
        payoutAccountNumber: opts.accountNumber,
        payoutAccountName: opts.accountName,
        status: 'AWAITING_CRYPTO',
        requiredConfirmations: requiredConfirmations(quote.assetSymbol),
        expiresAt,
      },
    });

    await tx.cryptoDeposit.create({
      data: {
        sellOrderId: newOrder.id,
        platformWalletId: platformWallet.id,
        network: quote.network,
        asset: quote.assetSymbol,
        amount: quote.cryptoAmount,
      },
    });

    return newOrder;
  });

  return { order };
}

// ─── PAYMENT WEBHOOK PROCESSOR ────────────────────────────────────────────────
// Kontrak KiPay v1.x: { event, sent_at, transaction: { trx_id, status, ... } }.
// Atomic idempotency via unique (kipayTrxId, eventType) + DB transaction (P16).

export interface KipayWebhookInput {
  event: 'transaction.paid' | 'transaction.expired' | 'webhook.test';
  sent_at?: string;
  deliveryId?: string;
  trxId: string;
  transaction: {
    trx_id: string;
    mode?: string;
    requested_amount?: number;
    unique_code?: number;
    amount?: number;
    fee_amount?: number;
    fee_bearer?: string;
    net_amount?: number;
    status?: string;
    provider?: string | null;
    matched_at?: string | null;
  };
}

/** Parse "YYYY-MM-DD HH:MM:SS" KiPay sebagai UTC eksplisit (kontrak tanpa offset). */
export function parseKipayTime(v: string | null | undefined): Date | null {
  if (!v || typeof v !== 'string') return null;
  const iso = /[zZ+-]\d{2}:?\d{2}$/.test(v.trim()) ? v.trim() : `${v.trim().replace(' ', 'T')}Z`;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * Verifikasi model amount KiPay v1.2.0:
 *   fee_bearer='merchant' (default): amount = requested_amount + unique_code
 *   fee_bearer='user':               amount = requested_amount + unique_code + fee_amount
 *
 * Selalu: upstream.amount === gross lokal.
 */
export function verifyKipayAmounts(
  local: { requested: number; unique: number; gross: number },
  upstream: { amount?: number; fee_bearer?: string; fee_amount?: number },
): { ok: true } | { ok: false; reason: string } {
  const { amount, fee_bearer, fee_amount } = upstream;

  if (!Number.isSafeInteger(local.requested) || !Number.isSafeInteger(local.unique) || !Number.isSafeInteger(local.gross)) {
    return { ok: false, reason: 'local amount fields are invalid' };
  }

  // Verify local gross matches the requested+unique formula
  if (local.requested + local.unique !== local.gross) {
    return { ok: false, reason: 'local requested_amount + unique_code does not equal gross amount' };
  }

  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) {
    return { ok: false, reason: 'upstream amount is invalid' };
  }

  // For fee_bearer='user', KiPay adds fee_amount on top — the gross paid by
  // the user is higher than what the merchant requested. Our local gross was
  // computed before knowing fee_bearer, so we accept either formula.
  if (fee_bearer === 'user' && typeof fee_amount === 'number' && Number.isSafeInteger(fee_amount)) {
    // user bears fee: amount = requested + unique + fee
    const expectedUser = local.requested + local.unique + fee_amount;
    if (amount !== expectedUser) {
      return { ok: false, reason: `upstream amount ${amount} does not match requested+unique+fee ${expectedUser}` };
    }
  } else {
    // merchant bears fee (default): amount = requested + unique
    if (amount !== local.gross) {
      return { ok: false, reason: `upstream amount ${amount} does not match local gross ${local.gross}` };
    }
  }

  return { ok: true };
}

/** Keputusan transisi murni — bisa di-unit-test (§38 V/W/X). */
export function decideTopUpTransition(
  orderStatus: string,
  kipayStatus: string,
): 'confirm' | 'expire' | 'keep' | 'ignore' {
  if (kipayStatus === 'paid') {
    return ['CREATED', 'PAYMENT_PENDING'].includes(orderStatus) ? 'confirm' : 'ignore';
  }
  if (kipayStatus === 'expired') {
    return ['CREATED', 'PAYMENT_PENDING'].includes(orderStatus) ? 'expire' : 'ignore';
  }
  return 'keep'; // pending/unknown → jangan tandai gagal (§26)
}

export async function processKipayWebhook(payload: KipayWebhookInput) {
  const { trxId, event } = payload;

  // Fast-path: already processed.
  const existing = await prisma.kipayWebhook.findUnique({
    where: { kipayTrxId_eventType: { kipayTrxId: trxId, eventType: event } },
  });
  if (existing?.processedAt) return { alreadyProcessed: true };

  // Find payment
  const payment = await prisma.payment.findUnique({
    where: { kipayTrxId: trxId },
    include: { topUpOrder: true },
  });
  if (!payment) {
    await prisma.kipayWebhook.upsert({
      where: { kipayTrxId_eventType: { kipayTrxId: trxId, eventType: event } },
      create: { kipayTrxId: trxId, eventType: event, payload: JSON.stringify(payload), processedAt: new Date() },
      update: {},
    });
    return { notFound: true };
  }

  // Atomically claim webhook: insert if absent, or reuse unprocessed record.
  // Unique constraint guarantees duplicate webhooks never fulfill twice.
  let webhookRecord: Awaited<ReturnType<typeof prisma.kipayWebhook.upsert>>;
  try {
    webhookRecord = await prisma.kipayWebhook.upsert({
      where: { kipayTrxId_eventType: { kipayTrxId: trxId, eventType: event } },
      create: { kipayTrxId: trxId, paymentId: payment.id, eventType: event, payload: JSON.stringify(payload) },
      update: { paymentId: payment.id },
    });
  } catch (err: unknown) {
    // Unique race: another worker claimed it concurrently.
    const raced = await prisma.kipayWebhook.findUnique({
      where: { kipayTrxId_eventType: { kipayTrxId: trxId, eventType: event } },
    });
    if (raced?.processedAt) return { alreadyProcessed: true };
    throw err;
  }
  if (webhookRecord.processedAt) return { alreadyProcessed: true };

  const order = payment.topUpOrder;

  // Skip already-processed orders (but still mark webhook processed for consistency).
  // PAYMENT_CREATE_UNKNOWN is reachable from webhook if the original POST left the
  // order in UNKNOWN and reconcile has not yet expired it.
  if (!['CREATED', 'PAYMENT_PENDING', 'PAYMENT_CREATE_UNKNOWN'].includes(order.status)) {
    await prisma.kipayWebhook.update({ where: { id: webhookRecord.id }, data: { processedAt: new Date() } });
    return { skipped: true };
  }

  if (event === 'transaction.paid' || event === 'transaction.expired') {
    // Both paid and expired flow through verifyAndFulfillTopUp — that function
    // performs a server-to-server GET and transitions to the correct terminal
    // state (PAYMENT_CONFIRMED or PAYMENT_FAILED) atomically. The dead
    // duplicate `else if (event === 'transaction.expired')` block has been
    // removed; expiry is handled inside verifyAndFulfillTopUp via
    // decideTopUpTransition → 'expire' branch.
    const result = await verifyAndFulfillTopUp(order.publicId);
    await prisma.kipayWebhook.update({ where: { id: webhookRecord.id }, data: { processedAt: new Date() } }).catch(() => {});
    return result;
  }

  await prisma.kipayWebhook.update({ where: { id: webhookRecord.id }, data: { processedAt: new Date() } });
  return { processed: true };
}

/**
 * Verifikasi server-to-server + fulfillment idempoten (§13/§20/§21).
 * dipakai webhook, payment-status endpoint, dan reconcile — ketiganya
 * konvergen ke state akhir yang sama apa pun urutan kedatangannya.
 */
export async function verifyAndFulfillTopUp(publicId: string, opts?: { throttleMs?: number }): Promise<
  | { state: 'CONFIRMED' }
  | { state: 'PENDING' }
  | { state: 'EXPIRED' }
  | { state: 'UNKNOWN'; reason: string }
  | { state: 'CONVERGED'; status: string }
  | { state: 'NOT_FOUND' }
> {
  const order = await prisma.topUpOrder.findUnique({
    where: { publicId },
    include: { payment: true },
  });
  if (!order || !order.payment || !order.payment.kipayTrxId) return { state: 'NOT_FOUND' };
  const payment = order.payment;
  const kipayTrxId: string = order.payment.kipayTrxId;

  if (!['CREATED', 'PAYMENT_PENDING'].includes(order.status)) {
    return { state: 'CONVERGED', status: order.status };
  }

  // Throttle upstream (§13/§28): layani dari DB bila baru diverifikasi.
  const throttleMs = opts?.throttleMs ?? 15000;
  if (payment.lastVerifiedAt && Date.now() - payment.lastVerifiedAt.getTime() < throttleMs) {
    if (payment.status === 'PAID' || order.status === 'PAYMENT_CONFIRMED') return { state: 'CONFIRMED' };
    return { state: 'PENDING' };
  }

  let verified: KipayTransaction;
  try {
    verified = await kipayGetTransaction(kipayTrxId);
  } catch (e) {
    // Upstream tak terjangkau / trx hilang: JANGAN ubah status (§26).
    await prisma.payment.update({
      where: { id: payment.id },
      data: { lastVerifiedAt: new Date() },
    }).catch(() => {});
    return { state: 'UNKNOWN', reason: e instanceof Error ? e.message : String(e) };
  }
  await prisma.payment.update({
    where: { id: payment.id },
    data: { lastVerifiedAt: new Date() },
  }).catch(() => {});

  const decision = decideTopUpTransition(order.status, verified.status);

  if (decision === 'keep') {
    return { state: 'PENDING' };
  }

  if (decision === 'expire') {
    await prisma.$transaction(async (tx) => {
      await tx.payment.update({ where: { id: payment.id }, data: { status: 'EXPIRED' } });
      await tx.topUpOrder.update({
        where: { id: order.id },
        data: { status: 'PAYMENT_FAILED', failureReason: 'QRIS expired — buat order baru.' },
      });
    });
    return { state: 'EXPIRED' };
  }

  // decision === 'confirm': verifikasi penuh SEBELUM fulfill (§41).
  // 1. Mode cocok (cegah campur sandbox/production §4).
  const expectedMode = (process.env.KIPAY_MODE ?? 'sandbox').trim();
  if (verified.mode !== expectedMode) {
    console.error(`[topup] mode mismatch trx=${payment.kipayTrxId}: upstream=${verified.mode} env=${expectedMode}`);
    return { state: 'UNKNOWN', reason: 'mode_mismatch' };
  }
  // 2. Amount verification menggunakan data dari KiPay upstream (trusted source).
  // requestedAmount di DB = nominal yang kita kirim ke KiPay (sebelum unique_code).
  // KiPay menambahkan unique_code dan mungkin fee_amount (jika fee_bearer=user).
  // Verifikasi: upstream.requested_amount harus cocok dengan local requestedAmount.
  const localRequested = Math.round(Number(payment.requestedAmount));

  // Jika unique_code belum tersimpan di DB (payment baru dibuat), ambil dari upstream.
  const localUnique = payment.uniqueCode ?? (verified.unique_code ?? 0);

  // Untuk fee_bearer='user': gross = requested + unique + fee
  // Untuk fee_bearer='merchant': gross = requested + unique
  const computedGross = verified.fee_bearer === 'user' && verified.fee_amount
    ? localRequested + localUnique + verified.fee_amount
    : localRequested + localUnique;

  // Verifikasi upstream amount cocok dengan yang seharusnya
  if (verified.amount !== computedGross) {
    console.error(
      `[topup] amount mismatch trx=${payment.kipayTrxId}: ` +
      `upstream=${verified.amount} computed=${computedGross} ` +
      `(requested=${localRequested} unique=${localUnique} fee_bearer=${verified.fee_bearer} fee=${verified.fee_amount})`
    );
    return { state: 'UNKNOWN', reason: 'amount_mismatch' };
  }

  // Verifikasi upstream requested_amount cocok dengan yang kita kirim
  if (verified.requested_amount !== undefined && verified.requested_amount !== localRequested) {
    console.error(
      `[topup] requested_amount mismatch trx=${payment.kipayTrxId}: ` +
      `upstream=${verified.requested_amount} local=${localRequested}`
    );
    return { state: 'UNKNOWN', reason: 'requested_amount_mismatch' };
  }

  // 3. Transisi atomik guarded (hanya sekali — konvergensi webhook vs polling).
  const transitioned = await prisma.$transaction(async (tx) => {
    const current = await tx.topUpOrder.findUnique({ where: { id: order.id }, select: { status: true } });
    if (!current || !['CREATED', 'PAYMENT_PENDING'].includes(current.status)) return false;
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'PAID',
        paidAt: parseKipayTime(verified.matched_at) ?? new Date(),
        provider: verified.provider,
        // Update dengan nilai aktual dari KiPay (unique_code & gross dari upstream)
        uniqueCode: verified.unique_code ?? undefined,
        grossAmount: verified.amount,         // actual amount yang dibayar user
        requestedAmount: verified.requested_amount ?? Math.round(Number(payment.requestedAmount)),
        feeAmount: verified.fee_amount ?? undefined,
      },
    });
    await tx.topUpOrder.update({ where: { id: order.id }, data: { status: 'PAYMENT_CONFIRMED' } });
    await tx.auditLog.create({
      data: {
        action: 'PAYMENT_CONFIRMED', entity: 'TopUpOrder', entityId: order.id,
        actor: order.walletAddress,
        metadata: JSON.stringify({ kipayTrxId: payment.kipayTrxId, amount: verified.amount }),
      },
    });
    return true;
  });

  if (!transitioned) return { state: 'CONVERGED', status: 'PAYMENT_CONFIRMED' };

  try {
    await processCryptoDelivery(order.id);
  } catch (err) {
    console.error('[verifyAndFulfillTopUp] delivery error (will be retried by reconcile):', err);
  }
  return { state: 'CONFIRMED' };
}

// ─── CRYPTO DELIVERY (double-send safe, P13) ──────────────────────────────────
// Explicit states: PENDING → BROADCASTED → CONFIRMING → CONFIRMED / FAILED / UNKNOWN.
// - txHash persisted IMMEDIATELY after broadcast, before confirmation check.
// - "not yet confirmed" is NEVER treated as "failed" while tx may exist.
// - Retry never creates a second payment when first tx may already exist.
// - Idempotency: existing withdrawal with txHash is resumed, not re-sent.

type DeliveryTxState = 'PENDING' | 'BROADCASTED' | 'CONFIRMING' | 'CONFIRMED' | 'FAILED' | 'UNKNOWN';

const DELIVERY_CONFIRM_TIMEOUT_MS = 30_000;

/**
 * Broadcast ONCE then confirm — never re-broadcast when tx may exist.
 * Returns txHash + state. Caller persists txHash immediately.
 */
async function broadcastOnce(
  bc: BlockchainProvider,
  destinationAddress: string,
  cryptoAmount: Decimal,
): Promise<{ txHash: string; state: DeliveryTxState }> {
  // broadcast — if this throws BEFORE returning a hash, safe to retry/fail.
  const result = await bc.sendTransaction(destinationAddress, cryptoAmount.toString());
  const txHash = result.txHash;
  if (!txHash) return { txHash: '', state: 'FAILED' };
  // Immediately after broadcast, tx is at best BROADCASTED/CONFIRMING — never FAILED.
  return { txHash, state: 'BROADCASTED' };
}

async function waitForConfirmation(
  bc: BlockchainProvider,
  txHash: string,
  timeoutMs = DELIVERY_CONFIRM_TIMEOUT_MS,
): Promise<DeliveryTxState> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const info = await bc.getTransaction(txHash);
      if (info?.isConfirmed) return 'CONFIRMED';
      if (info) return 'CONFIRMING'; // exists but not yet confirmed — keep waiting via cron
    } catch {
      return 'UNKNOWN';
    }
    await new Promise((r) => setTimeout(r, 3000));
    // Only one quick check here; cron reconcile continues polling.
    break;
  }
  // Not confirmed YET — do NOT treat as failed (P13).
  return 'CONFIRMING';
}

export async function processCryptoDelivery(topUpOrderId: string) {
  const order = await prisma.topUpOrder.findUnique({
    where: { id: topUpOrderId },
    include: { withdrawal: true },
  });
  if (!order) return;
  // Idempotency: already completed/failed terminal states are not re-processed
  // except CRYPTO_PROCESSING which is resumable by cron (P14).
  if (!['PAYMENT_CONFIRMED', 'CRYPTO_PROCESSING'].includes(order.status)) return;

  // If withdrawal already has txHash, resume confirmation instead of re-sending (no double-send).
  if (order.withdrawal?.txHash) {
    const bc0 = getBlockchainProvider(order.network as NetworkId);
    try {
      const info = await bc0.getTransaction(order.withdrawal.txHash);
      if (info?.isConfirmed) {
        await prisma.$transaction(async (tx) => {
          await tx.cryptoWithdrawal.update({
            where: { topUpOrderId: order.id },
            data: { status: 'CONFIRMED', confirmedAt: new Date() },
          });
          await tx.topUpOrder.update({
            where: { id: order.id },
            data: { status: 'COMPLETED', cryptoTxHash: order.withdrawal!.txHash!, completedAt: new Date() },
          });
        });
        return;
      }
      // Still confirming — leave as CRYPTO_PROCESSING for cron to re-check.
      await prisma.topUpOrder.update({
        where: { id: order.id },
        data: { status: 'CRYPTO_PROCESSING' },
      });
      return;
    } catch {
      return;
    }
  }

  // Claim processing state atomically (recoverable if process dies).
  if (order.status === 'PAYMENT_CONFIRMED') {
    await prisma.topUpOrder.update({ where: { id: topUpOrderId }, data: { status: 'CRYPTO_PROCESSING' } });
  }

  try {
    const bc = getBlockchainProvider(order.network as NetworkId);
    const network = await prisma.network.findUnique({ where: { networkId: order.network } });
    const wallet = network
      ? await prisma.platformWallet.findFirst({ where: { networkId: network.id, isActive: true } })
      : null;
    if (!wallet) throw new Error('No active platform wallet');

    // Idempotency key = order id (one withdrawal per order via unique constraint).
    const existingWithdrawal = await prisma.cryptoWithdrawal.findUnique({
      where: { topUpOrderId: order.id },
    });
    if (existingWithdrawal?.txHash) {
      // Another worker already broadcast — resume, don't re-send.
      return processCryptoDelivery(order.id);
    }

    let txHash: string;
    try {
      const b = await broadcastOnce(bc, order.destinationAddress, order.cryptoAmount);
      txHash = b.txHash;
      if (!txHash) throw new Error('Broadcast returned empty txHash');
    } catch (broadcastErr) {
      // Broadcast failed BEFORE hash — safe to mark FAILED (no tx exists).
      // If error is ambiguous (timeout after broadcast), mark UNKNOWN for manual reconcile.
      const msg = broadcastErr instanceof Error ? broadcastErr.message : String(broadcastErr);
      const ambiguous = /timeout|timed out|unknown|econnreset|socket/i.test(msg);
      if (ambiguous) {
        await prisma.cryptoWithdrawal.upsert({
          where: { topUpOrderId: order.id },
          create: {
            topUpOrderId: order.id,
            platformWalletId: wallet.id,
            network: order.network,
            asset: order.assetSymbol,
            amount: order.cryptoAmount,
            destination: order.destinationAddress,
            status: 'UNKNOWN',
          },
          update: { status: 'UNKNOWN' },
        });
        await prisma.auditLog.create({
          data: {
            action: 'CRYPTO_DELIVERY_UNKNOWN',
            entity: 'TopUpOrder',
            entityId: order.id,
            actor: 'system',
            metadata: JSON.stringify({ error: msg, note: 'broadcast ambiguous — manual reconcile required, no auto-retry send' }),
          },
        });
        return;
      }
      await prisma.topUpOrder.update({
        where: { id: topUpOrderId },
        data: { status: 'CRYPTO_FAILED', failureReason: msg },
      });
      await prisma.auditLog.create({
        data: {
          action: 'CRYPTO_DELIVERY_FAILED',
          entity: 'TopUpOrder',
          entityId: order.id,
          actor: order.walletAddress,
          metadata: JSON.stringify({ error: msg }),
        },
      }).catch(() => {});
      return;
    }

    // Persist txHash IMMEDIATELY after broadcast (P13) — before confirmation check.
    await prisma.cryptoWithdrawal.upsert({
      where: { topUpOrderId: order.id },
      create: {
        topUpOrderId: order.id,
        platformWalletId: wallet.id,
        txHash,
        network: order.network,
        asset: order.assetSymbol,
        amount: order.cryptoAmount,
        destination: order.destinationAddress,
        status: 'BROADCASTED',
        sentAt: new Date(),
      },
      update: { txHash, status: 'BROADCASTED', sentAt: new Date() },
    });
    await prisma.topUpOrder.update({
      where: { id: order.id },
      data: { status: 'CRYPTO_PROCESSING', cryptoTxHash: txHash },
    });

    const state = await waitForConfirmation(bc, txHash);
    if (state === 'CONFIRMED') {
      await prisma.$transaction(async (tx) => {
        await tx.cryptoWithdrawal.update({
          where: { topUpOrderId: order.id },
          data: { status: 'CONFIRMED', confirmedAt: new Date() },
        });
        await tx.topUpOrder.update({
          where: { id: order.id },
          data: { status: 'COMPLETED', cryptoTxHash: txHash, completedAt: new Date() },
        });
      });
    } else {
      // CONFIRMING/UNKNOWN — leave recoverable for cron, never mark FAILED here.
      await prisma.cryptoWithdrawal.update({
        where: { topUpOrderId: order.id },
        data: { status: state },
      });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Only mark FAILED if no withdrawal txHash exists (no tx broadcast).
    const w = await prisma.cryptoWithdrawal.findUnique({ where: { topUpOrderId } });
    if (!w?.txHash) {
      await prisma.topUpOrder.update({
        where: { id: topUpOrderId },
        data: { status: 'CRYPTO_FAILED', failureReason: msg },
      });
    }
    console.error('[CryptoDelivery] error:', msg);
  }
}

export async function processSellPayout(sellOrderId: string) {
  const order = await prisma.sellOrder.findUnique({ where: { id: sellOrderId } });
  if (!order || order.status !== 'CRYPTO_CONFIRMED') return;

  await prisma.sellOrder.update({ where: { id: sellOrderId }, data: { status: 'PAYOUT_PROCESSING' } });

  try {
    const idempotencyKey = `payout-${order.id}`;

    // Record payout intent — stays PROCESSING until admin confirms manually
    // via /api/admin/orders/sell/:id/confirm-payout or Fyas integration is enabled
    await prisma.payout.upsert({
      where: { sellOrderId: order.id },
      create: {
        sellOrderId: order.id,
        bankName: order.payoutBankName ?? '',
        accountNumber: order.payoutAccountNumber ?? '',
        accountName: order.payoutAccountName ?? '',
        amount: order.totalIdrPayout,
        status: 'PROCESSING',
        providerRef: idempotencyKey,
      },
      update: { status: 'PROCESSING', providerRef: idempotencyKey },
    });

    await prisma.auditLog.create({
      data: {
        action: 'PAYOUT_INITIATED',
        entity: 'SellOrder',
        entityId: order.id,
        actor: 'system',
        metadata: JSON.stringify({
          bankName: order.payoutBankName,
          accountNumber: order.payoutAccountNumber?.slice(-4),
          amount: order.totalIdrPayout.toString(),
          note: 'auto-transfer disabled — awaiting admin confirmation',
        }),
      },
    });

    // AUTO-TRANSFER DISABLED — use admin dashboard to confirm payout manually.
    // To enable Fyas auto-transfer, uncomment the block below and set FYAS_API_KEY in .env
    /*
    const { fyasCreateBankTransfer, fyasBankCode, FYAS_SUPPORTED_BANKS } = await import('./fyas');
    const bankCode = fyasBankCode(order.payoutBankName ?? '');
    if (!bankCode) throw new Error(`Bank tidak didukung: ${order.payoutBankName}. Didukung: ${FYAS_SUPPORTED_BANKS.join(', ')}`);
    const nominal = Math.round(parseFloat(order.totalIdrPayout.toString()));
    const transfer = await fyasCreateBankTransfer({
      bankCode,
      accountNumber: order.payoutAccountNumber ?? '',
      nominal,
      idempotencyKey,
    });
    await prisma.payout.updateMany({ where: { sellOrderId: order.id }, data: { providerRef: transfer.refId, sentAt: new Date() } });
    if (transfer.status === 'SUCCESS') { await completeSellPayout(order.id, transfer.refId); return; }
    if (transfer.status === 'FAILED' || transfer.status === 'REFUNDED') throw new Error(`Fyas ${transfer.status}: ${transfer.refId}`);
    await pollFyasTransferUntilFinal(order.id, transfer.refId);
    */
  } catch (err: any) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[processSellPayout] error:', message);
    await prisma.$transaction(async (tx) => {
      await tx.payout.updateMany({
        where: { sellOrderId: order.id },
        data: { status: 'FAILED', failureReason: message },
      });
      await tx.sellOrder.update({
        where: { id: sellOrderId },
        data: { status: 'PAYOUT_FAILED', failureReason: message },
      });
      await tx.auditLog.create({
        data: {
          action: 'PAYOUT_FAILED',
          entity: 'SellOrder',
          entityId: order.id,
          actor: 'system',
          metadata: JSON.stringify({ error: message }),
        },
      });
    });
  }
}

/**
 * Poll Fyas for transfer status until SUCCESS/FAILED/REFUNDED or timeout.
 * Runs async after processSellPayout returns — does not block the HTTP response.
 */
async function pollFyasTransferUntilFinal(
  sellOrderId: string,
  refId: string,
  maxAttempts = 18,   // 18 × 10s = 3 minutes
  intervalMs = 10_000,
): Promise<void> {
  const { fyasGetBankTransfer } = await import('./fyas');

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await new Promise(r => setTimeout(r, intervalMs));

    try {
      const transfer = await fyasGetBankTransfer(refId);

      if (transfer.status === 'SUCCESS') {
        await completeSellPayout(sellOrderId, refId);
        return;
      }

      if (transfer.status === 'FAILED' || transfer.status === 'REFUNDED') {
        const reason = `Fyas transfer ${transfer.status} (refId: ${refId})`;
        await prisma.$transaction(async (tx) => {
          await tx.payout.updateMany({
            where: { sellOrderId },
            data: { status: 'FAILED', failureReason: reason },
          });
          await tx.sellOrder.update({
            where: { id: sellOrderId },
            data: { status: 'PAYOUT_FAILED', failureReason: reason },
          });
        });
        console.error('[pollFyasTransfer]', reason);
        return;
      }

      // PENDING or PROCESSING — keep polling
      console.info(`[pollFyasTransfer] attempt ${attempt}/${maxAttempts} — status: ${transfer.status}`);
    } catch (err) {
      console.warn(`[pollFyasTransfer] attempt ${attempt} error:`, err);
    }
  }

  // Timed out — leave as PAYOUT_PROCESSING for admin to resolve
  console.error(`[pollFyasTransfer] timed out after ${maxAttempts} attempts for refId: ${refId}`);
  await prisma.auditLog.create({
    data: {
      action: 'PAYOUT_POLL_TIMEOUT',
      entity: 'SellOrder',
      entityId: sellOrderId,
      actor: 'system',
      metadata: JSON.stringify({ refId, attempts: maxAttempts }),
    },
  });
}

/**
 * Mark payout as completed and order as COMPLETED.
 * Called by: Fyas SUCCESS status, admin confirm-payout endpoint.
 */
export async function completeSellPayout(sellOrderId: string, providerRef?: string) {
  await prisma.$transaction(async (tx) => {
    await tx.payout.updateMany({
      where: { sellOrderId },
      data: {
        status: 'COMPLETED',
        providerRef: providerRef ?? undefined,
        sentAt: new Date(),
        completedAt: new Date(),
      },
    });
    await tx.sellOrder.update({
      where: { id: sellOrderId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        action: 'PAYOUT_COMPLETED',
        entity: 'SellOrder',
        entityId: sellOrderId,
        actor: 'system',
        metadata: JSON.stringify({ provider: 'fyas', providerRef }),
      },
    });
  });
}
