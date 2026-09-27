import Decimal from 'decimal.js';
import { prisma } from './prisma';
import { validateAndUseQuote, AssetSymbol, NetworkId, validateAssetNetwork } from './pricing';
import { getBlockchainProvider, type BlockchainProvider } from './blockchain';
import {
  xenditCreatePaymentRequest,
  xenditGetPaymentRequest,
  xenditCreatePayout,
  xenditGetPayout,
  payoutIdempotencyKeyForSellOrder,
  isXenditSuccessStatus,
  isXenditFailedStatus,
  isXenditPayoutSuccess,
  isXenditPayoutFailed,
  verifyXenditPaymentAmounts,
  decideXenditTopUpTransition,
  getXenditConfig,
  XenditError,
  XENDIT_PAYMENT_CHANNEL,
} from './xendit';
import { generatePublicId, generateOrderNumber } from './id';
import { AppError, ValidationError } from './errors';

// Re-export pure Xendit transition helpers (single source in ./xendit).
export { verifyXenditPaymentAmounts, decideXenditTopUpTransition } from './xendit';

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
  const publicId = generatePublicId('krm');
  const orderExpiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 min

  // Order + payment DIBUAT DULU (recoverable) — Xendit menyusul.
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

  // Create Xendit QRIS payment — reference_id = KORAMP publicId (one-to-one).
  // Decimal rounding, never float. Customer amount = KORAMP totalIdr.
  const idrInt = new Decimal(quote.totalIdr.toString()).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  // Provider capability guard: documented QRIS max (fail fast before upstream).
  try {
    const xcfg = getXenditConfig();
    if (idrInt > xcfg.paymentMaxIdr) {
      const failExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
      const recovered = await prisma.$transaction(async (tx) => {
        await tx.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', expiresAt: failExpiresAt } });
        const failedOrder = await tx.topUpOrder.update({
          where: { id: order.id },
          data: { status: 'PAYMENT_CREATE_FAILED', failureReason: `Nominal melebihi batas QRIS (${xcfg.paymentMaxIdr} IDR).`, expiresAt: failExpiresAt },
        });
        return { order: failedOrder, payment: null };
      });
      return {
        ...recovered,
        providerOrderId: null,
        paymentCreation: { state: 'FAILED', message: `Nominal melebihi batas pembayaran QRIS. Maksimum ${xcfg.paymentMaxIdr} IDR.` },
      };
    }
  } catch {
    // Config missing → fall through to create call which surfaces CONFIGURATION safely.
  }
  let xpOrder;
  try {
    xpOrder = await xenditCreatePaymentRequest({ referenceId: publicId, amountIdr: idrInt });
  } catch (e) {
    // Gagal deterministik (400/404/409) → FAILED, user buat order baru (tanpa retry).
    // Ambigu (timeout/5xx) → UNKNOWN, JANGAN buat transaksi kedua (§10);
    // reconcile men-expire-nya agar user bisa buat order baru dengan aman.
    const isUnknown = e instanceof XenditError && (e.category === 'UNKNOWN' || e.category === 'TRANSIENT');
    const safeCategory = e instanceof XenditError ? e.category : 'UNKNOWN';
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
            ? 'Pembayaran tidak dapat dipastikan. Buat order baru.'
            : 'Layanan pembayaran tidak tersedia. Buat order baru.',
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
      providerOrderId: null,
      paymentCreation: {
        state: isUnknown ? 'UNKNOWN' : 'FAILED',
        message: 'Layanan pembayaran sedang tidak tersedia. Silakan coba lagi.',
      },
    };

  }

  // Store Xendit response ke payment record (provider fields generik).
  const updatedPayment = await prisma.payment.update({
    where: { id: payment.id },
    data: {
      provider: 'xendit',
      providerOrderId: xpOrder.paymentRequestId,
      providerStatus: xpOrder.status,
      providerChannel: xpOrder.channelCode ?? XENDIT_PAYMENT_CHANNEL,
      payUrl: xpOrder.redirectUrl ?? null,
      qrPayload: xpOrder.qrString ?? null,
      providerCreatedAt: new Date(),
      providerUpdatedAt: new Date(),
      status: 'PENDING',
      note: orderNumber,
      lastVerifiedAt: new Date(),
    },
  });

  await prisma.topUpOrder.update({
    where: { id: order.id },
    data: { status: 'PAYMENT_PENDING' },
  });

  return { order, payment: updatedPayment, providerOrderId: xpOrder.paymentRequestId, payUrl: xpOrder.redirectUrl ?? null };
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
  const publicId = generatePublicId('kms');
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

// ─── PAYMENT WEBHOOK PROCESSOR (Xendit) ─────────────────────────────────────────
// Webhook hanya sinyal — fulfillment selalu via server-to-server GET payment request.

export interface XenditPaymentWebhookInput {
  event: string;
  paymentRequestId: string;
  referenceId: string;
  status: string;
  paymentId?: string | null;
}

export async function processXenditPaymentWebhook(payload: XenditPaymentWebhookInput) {
  const { paymentRequestId, event } = payload;

  // Fast-path: already processed (kind+event+ids unique).
  const existing = await prisma.xenditWebhook.findFirst({
    where: { kind: 'PAYMENT', event, paymentRequestId },
  });
  if (existing?.processedAt) return { alreadyProcessed: true };

  // Find payment by Xendit payment_request_id.
  const payment = await prisma.payment.findUnique({
    where: { providerOrderId: paymentRequestId },
    include: { topUpOrder: true },
  });
  if (!payment) {
    await prisma.xenditWebhook.upsert({
      where: { kind_event_paymentRequestId_payoutId: { kind: 'PAYMENT', event, paymentRequestId, payoutId: '' } },
      create: { kind: 'PAYMENT', event, paymentRequestId, referenceId: payload.referenceId, status: payload.status, payload: JSON.stringify(payload), processedAt: new Date() },
      update: {},
    });
    return { notFound: true };
  }

  // Atomically claim webhook. Unique constraint guarantees duplicates never fulfill twice.
  let webhookRecord: Awaited<ReturnType<typeof prisma.xenditWebhook.upsert>>;
  try {
    webhookRecord = await prisma.xenditWebhook.upsert({
      where: { kind_event_paymentRequestId_payoutId: { kind: 'PAYMENT', event, paymentRequestId, payoutId: '' } },
      create: { kind: 'PAYMENT', event, paymentRequestId, referenceId: payload.referenceId, status: payload.status, paymentId: payment.id, payload: JSON.stringify(payload) },
      update: { paymentId: payment.id },
    });
  } catch (err: unknown) {
    const raced = await prisma.xenditWebhook.findFirst({
      where: { kind: 'PAYMENT', event, paymentRequestId },
    });
    if (raced?.processedAt) return { alreadyProcessed: true };
    throw err;
  }
  if (webhookRecord.processedAt) return { alreadyProcessed: true };

  const order = payment.topUpOrder;

  // Skip already-processed orders (but still mark webhook processed for consistency).
  if (!['CREATED', 'PAYMENT_PENDING', 'PAYMENT_CREATE_UNKNOWN', 'PAYMENT_CONFIRMED', 'CRYPTO_PROCESSING'].includes(order.status)) {
    await prisma.xenditWebhook.update({ where: { id: webhookRecord.id }, data: { processedAt: new Date() } });
    return { skipped: true };
  }

  // Webhook hanya sinyal — fulfillment via server-to-server GET (single path).
  const result = await verifyAndFulfillTopUp(order.publicId);
  await prisma.xenditWebhook.update({ where: { id: webhookRecord.id }, data: { processedAt: new Date() } }).catch(() => {});
  return result;
}

/**
 * Verifikasi server-to-server + fulfillment idempoten.
 * dipakai webhook, payment-status endpoint, dan reconcile — ketiganya
 * konvergen ke state akhir yang sama apa pun urutan kedatangannya.
 *
 * Xendit flow: SUCCEEDED → PAYMENT_CONFIRMED → processCryptoDelivery()
 * (KORAMP mengirim kripto dari platform wallet). FAILED/CANCELED/EXPIRED
 * → PAYMENT_FAILED.
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
  if (!order || !order.payment || !order.payment.providerOrderId) return { state: 'NOT_FOUND' };
  const payment = order.payment;
  const providerOrderId: string = order.payment.providerOrderId;

  if (!['CREATED', 'PAYMENT_PENDING', 'PAYMENT_CONFIRMED', 'CRYPTO_PROCESSING'].includes(order.status)) {
    return { state: 'CONVERGED', status: order.status };
  }

  // Throttle upstream (§13/§28): layani dari DB bila baru diverifikasi.
  const throttleMs = opts?.throttleMs ?? 15000;
  if (payment.lastVerifiedAt && Date.now() - payment.lastVerifiedAt.getTime() < throttleMs) {
    if (payment.status === 'PAID' || order.status === 'PAYMENT_CONFIRMED') return { state: 'CONFIRMED' };
    return { state: 'PENDING' };
  }

  // Claim the throttle window SEBELUM upstream call yang lambat.
  // Tanpa ini, poll bersamaan menumpuk request upstream + write SQLite.
  await prisma.payment.update({
    where: { id: payment.id },
    data: { lastVerifiedAt: new Date(), providerUpdatedAt: new Date() },
  }).catch(() => {});

  let verified: Awaited<ReturnType<typeof xenditGetPaymentRequest>>;
  try {
    verified = await xenditGetPaymentRequest(providerOrderId);
  } catch (e) {
    // Upstream tak terjangkau: JANGAN ubah status (§26).
    await prisma.payment.update({
      where: { id: payment.id },
      data: { lastVerifiedAt: new Date() },
    }).catch(() => {});
    return { state: 'UNKNOWN', reason: e instanceof Error ? e.message : String(e) };
  }
  await prisma.payment.update({
    where: { id: payment.id },
    data: { lastVerifiedAt: new Date(), providerStatus: verified.status, providerUpdatedAt: new Date() },
  }).catch(() => {});

  const decision = decideXenditTopUpTransition(order.status, verified.status);

  if (decision === 'keep') {
    return { state: 'PENDING' };
  }
  if (decision === 'ignore') {
    return { state: 'CONVERGED', status: order.status };
  }

  if (decision === 'expire') {
    await prisma.$transaction(async (tx) => {
      await tx.payment.update({ where: { id: payment.id }, data: { status: 'EXPIRED' } });
      await tx.topUpOrder.update({
        where: { id: order.id },
        data: {
          status: 'PAYMENT_FAILED',
          failureReason: 'Pembayaran gagal/kadaluarsa. Buat order baru.',
        },
      });
    });
    return { state: 'EXPIRED' };
  }

  // decision === 'confirm' (SUCCEEDED): verifikasi penuh SEBELUM fulfill.
  const localTotalIdr = Math.round(Number(order.totalIdr));
  const amountCheck = verifyXenditPaymentAmounts(
    { totalIdr: localTotalIdr, publicId: order.publicId, providerOrderId },
    {
      requestAmount: verified.requestAmount,
      referenceId: verified.referenceId,
      paymentRequestId: verified.paymentRequestId,
      currency: verified.currency,
      channelCode: verified.channelCode,
    },
  );
  if (!amountCheck.ok) {
    console.error(`[topup] xendit verification failed order=${order.publicId}: ${amountCheck.reason}`);
    return { state: 'UNKNOWN', reason: amountCheck.reason };
  }

  if (decision === 'confirm') {
    // 3. Transisi atomik guarded (hanya sekali — konvergensi webhook vs polling).
    const transitioned = await prisma.$transaction(async (tx) => {
      const current = await tx.topUpOrder.findUnique({ where: { id: order.id }, select: { status: true } });
      if (!current || !['CREATED', 'PAYMENT_PENDING'].includes(current.status)) return false;
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'PAID',
          paidAt: new Date(),
          provider: 'xendit',
          providerStatus: verified.status,
          providerChannel: verified.channelCode ?? XENDIT_PAYMENT_CHANNEL,
          providerUpdatedAt: new Date(),
        },
      });
      await tx.topUpOrder.update({ where: { id: order.id }, data: { status: 'PAYMENT_CONFIRMED' } });
      await tx.auditLog.create({
        data: {
          action: 'PAYMENT_CONFIRMED', entity: 'TopUpOrder', entityId: order.id,
          actor: order.walletAddress,
          metadata: JSON.stringify({ providerOrderId, status: verified.status }),
        },
      });
      return true;
    });

    if (!transitioned) return { state: 'CONVERGED', status: 'PAYMENT_CONFIRMED' };
    // Xendit hanya menagih fiat — KORAMP mengirim kripto via delivery engine.
    // Fire-and-forget agar webhook/polling tetap cepat; reconcile memulihkan bila gagal.
    void processCryptoDelivery(order.id).catch((e) => console.error('[topup] delivery trigger failed:', e));
    return { state: 'CONFIRMED' };
  }

  return { state: 'CONVERGED', status: order.status };
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
    include: { withdrawal: true, payment: { select: { provider: true } } },
  });
  if (!order) return;
  // Xendit collects fiat only — KORAMP always delivers crypto for new orders.
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
    const idempotencyKey = payoutIdempotencyKeyForSellOrder(order.id);

    // Record payout intent with deterministic idempotency key (stable across retries).
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
        idempotencyKey,
      },
      update: { status: 'PROCESSING', providerRef: idempotencyKey, idempotencyKey },
    });

    await prisma.auditLog.create({
      data: {
        action: 'PAYOUT_INITIATED',
        entity: 'SellOrder',
        entityId: order.id,
        actor: 'system',
        metadata: JSON.stringify({
          provider: 'xendit',
          bankName: order.payoutBankName,
          accountNumber: order.payoutAccountNumber?.slice(-4),
          amount: order.totalIdrPayout.toString(),
        }),
      },
    });

    // Xendit Payout API v3 — same idempotency key on every retry (no double payout).
    const nominal = new Decimal(order.totalIdrPayout.toString()).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
    const payout = await xenditCreatePayout({
      referenceId: order.publicId,
      idempotencyKey,
      bankName: order.payoutBankName ?? '',
      accountNumber: order.payoutAccountNumber ?? '',
      accountName: order.payoutAccountName ?? '',
      amountIdr: nominal,
    });
    await prisma.payout.updateMany({
      where: { sellOrderId: order.id },
      data: { providerRef: payout.payoutId, xenditPayoutId: payout.payoutId, xenditStatus: payout.status, sentAt: new Date() },
    });
    if (isXenditPayoutSuccess(payout.status)) {
      await completeSellPayout(order.id, payout.payoutId);
      return;
    }
    if (isXenditPayoutFailed(payout.status)) {
      throw new Error(`Xendit payout ${payout.status}: ${payout.payoutId}`);
    }
    // ACCEPTED/ROUTING/etc — webhook + reconcile converge; poll briefly async.
    void pollXenditPayoutUntilFinal(order.id, payout.payoutId);
  } catch (err: unknown) {
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
 * Poll Xendit payout until SUCCEEDED/FAILED or timeout.
 * Runs async after processSellPayout returns — does not block the HTTP response.
 * Webhook + this poll + reconcile converge to the same state.
 */
async function pollXenditPayoutUntilFinal(
  sellOrderId: string,
  payoutId: string,
  maxAttempts = 18,   // 18 × 10s = 3 minutes
  intervalMs = 10_000,
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await new Promise(r => setTimeout(r, intervalMs));

    try {
      const payout = await xenditGetPayout(payoutId);
      await prisma.payout.updateMany({ where: { sellOrderId }, data: { xenditStatus: payout.status } }).catch(() => {});

      if (isXenditPayoutSuccess(payout.status)) {
        await completeSellPayout(sellOrderId, payoutId);
        return;
      }

      if (isXenditPayoutFailed(payout.status)) {
        const reason = `Xendit payout ${payout.status} (payoutId: ${payoutId})`;
        await prisma.$transaction(async (tx) => {
          await tx.payout.updateMany({
            where: { sellOrderId },
            data: { status: 'FAILED', failureReason: reason, xenditStatus: payout.status, failureCode: payout.status },
          });
          await tx.sellOrder.update({
            where: { id: sellOrderId },
            data: { status: 'PAYOUT_FAILED', failureReason: reason },
          });
        });
        console.error('[pollXenditPayout]', reason);
        return;
      }

      // ACCEPTED/ROUTING/etc — keep polling
      console.info(`[pollXenditPayout] attempt ${attempt}/${maxAttempts} — status: ${payout.status}`);
    } catch (err) {
      console.warn(`[pollXenditPayout] attempt ${attempt} error:`, err);
    }
  }

  // Timed out — leave as PAYOUT_PROCESSING for webhook/reconcile/admin to resolve
  console.error(`[pollXenditPayout] timed out after ${maxAttempts} attempts for payoutId: ${payoutId}`);
  await prisma.auditLog.create({
    data: {
      action: 'PAYOUT_POLL_TIMEOUT',
      entity: 'SellOrder',
      entityId: sellOrderId,
      actor: 'system',
      metadata: JSON.stringify({ payoutId, attempts: maxAttempts }),
    },
  });
}

/** Reconcile a single payout server-side (used by webhook + cron). */
export async function verifyAndFulfillPayout(sellOrderId: string): Promise<{ state: string }> {
  const payout = await prisma.payout.findUnique({ where: { sellOrderId } });
  if (!payout?.xenditPayoutId) return { state: 'PENDING' };
  let remote: Awaited<ReturnType<typeof xenditGetPayout>> | undefined;
  try {
    remote = await xenditGetPayout(payout.xenditPayoutId);
  } catch {
    return { state: 'UNKNOWN' };
  }
  if (!remote) return { state: 'UNKNOWN' };
  const r = remote;
  await prisma.payout.updateMany({ where: { sellOrderId }, data: { xenditStatus: r.status } }).catch(() => {});
  if (isXenditPayoutSuccess(r.status)) {
    await completeSellPayout(sellOrderId, r.payoutId);
    return { state: 'COMPLETED' };
  }
  if (isXenditPayoutFailed(r.status)) {
    const reason = `Xendit payout ${r.status}`;
    await prisma.$transaction(async (tx) => {
      await tx.payout.updateMany({ where: { sellOrderId }, data: { status: 'FAILED', failureReason: reason, xenditStatus: r.status, failureCode: r.status } });
      await tx.sellOrder.update({ where: { id: sellOrderId }, data: { status: 'PAYOUT_FAILED', failureReason: reason } });
    });
    return { state: 'FAILED' };
  }
  return { state: 'PENDING' };
}

/** Xendit payout webhook processor — signal → server-side GET → converge. */
export async function processXenditPayoutWebhook(payload: { event: string; payoutId: string; referenceId: string; status: string }) {
  const { event, payoutId, referenceId } = payload;
  const existing = await prisma.xenditWebhook.findFirst({ where: { kind: 'PAYOUT', event, xenditPayoutId: payoutId } });
  if (existing?.processedAt) return { alreadyProcessed: true };
  let record;
  try {
    record = await prisma.xenditWebhook.upsert({
      where: { kind_event_paymentRequestId_payoutId: { kind: 'PAYOUT', event, paymentRequestId: '', payoutId } },
      create: { kind: 'PAYOUT', event, xenditPayoutId: payoutId, referenceId, status: payload.status, payload: JSON.stringify(payload) },
      update: {},
    });
  } catch {
    const raced = await prisma.xenditWebhook.findFirst({ where: { kind: 'PAYOUT', event, xenditPayoutId: payoutId } });
    if (raced?.processedAt) return { alreadyProcessed: true };
    throw new Error('webhook race');
  }
  if (record.processedAt) return { alreadyProcessed: true };
  // Locate payout by Xendit id, fall back to reference (publicId → sell order).
  let payout = await prisma.payout.findUnique({ where: { xenditPayoutId: payoutId } });
  if (!payout) {
    const sellOrder = await prisma.sellOrder.findUnique({ where: { publicId: referenceId }, include: { payout: true } });
    payout = sellOrder?.payout ?? null;
  }
  if (!payout) {
    await prisma.xenditWebhook.update({ where: { id: record.id }, data: { processedAt: new Date() } });
    return { notFound: true };
  }
  const result = await verifyAndFulfillPayout(payout.sellOrderId);
  await prisma.xenditWebhook.update({ where: { id: record.id }, data: { payoutId: payout.id, processedAt: new Date() } }).catch(() => {});
  return result;
}

/**
 * Mark payout as completed and order as COMPLETED.
 * Called by: Xendit SUCCEEDED status, payout webhook, admin confirm-payout endpoint.
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
        metadata: JSON.stringify({ provider: 'xendit', providerRef }),
      },
    });
  });
}
