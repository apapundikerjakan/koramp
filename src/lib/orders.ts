import Decimal from 'decimal.js';
import { prisma } from './prisma';
import { validateAndUseQuote, AssetSymbol, NetworkId, validateAssetNetwork } from './pricing';
import { getBlockchainProvider, type BlockchainProvider } from './blockchain';
import {
  transfiCreateOnrampOrder,
  transfiGetOrder,
  TransfiError,
  decideTransfiTransition,
  shouldSkipKipremDelivery,
  type TransfiOrderStatus,
} from './transfi';
import { generatePublicId, generateOrderNumber } from './id';
import { AppError, ValidationError } from './errors';

/**
 * TransFi destination tickers per KORAMP asset (docs: supported-crypto table).
 * MUST be verified per-MID via List Tokens in sandbox before enabling a pair.
 * Native only — never silently substitute stablecoins (separate decision).
 */
const TRANSFI_DESTINATION_TICKER: Record<string, string> = {
  SOL: 'SOL',
  ETH: 'ETH',
  BNB: 'BNBBSC',
};

export function transfiTickerForAsset(assetSymbol: string): string {
  const ticker = TRANSFI_DESTINATION_TICKER[assetSymbol];
  if (!ticker) throw new ValidationError(`Aset ${assetSymbol} belum didukung TransFi`);
  return ticker;
}

/** TransFi sender (UX-) — operator-provisioned. KORAMP collects no PII. */
export function transfiSenderUserId(): string {
  const v = (process.env.TRANSFI_SENDER_USER_ID ?? '').trim();
  if (!v) {
    throw new TransfiError('config', 'CONFIGURATION');
  }
  return v;
}

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

  // Order + payment DIBUAT DULU (recoverable §9/§27) — TransFi menyusul.
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

  // Create TransFi onramp order — partnerId = KORAMP publicId (one-to-one).
  // Decimal rounding, never float (P23). Customer amount = KORAMP totalIdr.
  const idrInt = new Decimal(quote.totalIdr.toString()).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  let tfOrder;
  try {
    tfOrder = await transfiCreateOnrampOrder({
      userId: transfiSenderUserId(),
      partnerId: publicId,
      purposeCode: (process.env.TRANSFI_PURPOSE_CODE ?? 'company_expenses').trim() || 'company_expenses',
      purposeCodeReason: (process.env.TRANSFI_PURPOSE_CODE_REASON ?? '').trim() || undefined,
      sourceCurrency: 'IDR',
      sourceAmount: idrInt,
      paymentType: (process.env.TRANSFI_PAYMENT_TYPE ?? '').trim() || undefined,
      paymentCode: (process.env.TRANSFI_PAYMENT_CODE ?? '').trim() || undefined,
      destinationCurrency: transfiTickerForAsset(quote.assetSymbol),
      walletAddress: opts.walletAddress,
    });
  } catch (e) {
    // Gagal deterministik (400/404/409) → FAILED, user buat order baru (tanpa retry).
    // Ambigu (timeout/5xx) → UNKNOWN, JANGAN buat transaksi kedua (§10);
    // reconcile men-expire-nya agar user bisa buat order baru dengan aman.
    const isUnknown = e instanceof TransfiError && (e.category === 'UNKNOWN' || e.category === 'TRANSIENT');
    const safeCategory = e instanceof TransfiError ? e.category : 'UNKNOWN';
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

  // Store TransFi response ke payment record (provider fields generik).
  const updatedPayment = await prisma.payment.update({
    where: { id: payment.id },
    data: {
      provider: 'transfi',
      providerOrderId: tfOrder.orderId,
      providerStatus: tfOrder.status,
      payUrl: tfOrder.payUrl ?? null,
      qrPayload: tfOrder.qrCode ?? null,
      providerFee: tfOrder.feeData?.totalFee != null ? new Decimal(tfOrder.feeData.totalFee) : undefined,
      providerRate: tfOrder.feeData?.exchangeRate != null ? new Decimal(tfOrder.feeData.exchangeRate) : undefined,
      providerQuote: tfOrder.feeData ? JSON.stringify(tfOrder.feeData) : undefined,
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

  return { order, payment: updatedPayment, providerOrderId: tfOrder.orderId, payUrl: tfOrder.payUrl ?? null };
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

// ─── PAYMENT WEBHOOK PROCESSOR (TransFi onramp) ───────────────────────────────
// Kontrak: { eventId, entityId (OR-...), entityType, status, ... }.
// Atomic idempotency via unique (orderId, eventId) + DB transaction.
// Webhook hanya sinyal — fulfillment selalu via server-to-server GET order.

export interface TransfiWebhookInput {
  eventId: string;
  orderId: string;
  status: TransfiOrderStatus;
}

/**
 * Verifikasi nilai TransFi vs lokal:
 * - feeData.depositAmount (jika ada) harus == totalIdr KORAMP (exact int).
 * - destination wallet harus == order.destinationAddress.
 * - cryptoTicker harus == ticker ekspektasi aset.
 */
export function verifyTransfiAmounts(
  local: { totalIdr: number; destinationAddress: string; ticker: string },
  upstream: { fiatAmount?: number; destinationWalletAddress?: string; cryptoTicker?: string },
): { ok: true } | { ok: false; reason: string } {
  if (!Number.isSafeInteger(local.totalIdr) || local.totalIdr <= 0) {
    return { ok: false, reason: 'local totalIdr invalid' };
  }
  if (upstream.fiatAmount !== undefined && upstream.fiatAmount !== local.totalIdr) {
    return { ok: false, reason: `upstream fiatAmount ${upstream.fiatAmount} != local ${local.totalIdr}` };
  }
  if (!upstream.destinationWalletAddress) {
    return { ok: false, reason: 'upstream destination wallet missing' };
  }
  // EVM hex is case-insensitive; Solana base58 is case-sensitive (exact).
  const a = upstream.destinationWalletAddress;
  const b = local.destinationAddress;
  const same = a.startsWith('0x') || b.startsWith('0x')
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
  if (!same) {
    return { ok: false, reason: 'upstream destination wallet mismatch' };
  }
  if (upstream.cryptoTicker && upstream.cryptoTicker !== local.ticker) {
    return { ok: false, reason: `upstream ticker ${upstream.cryptoTicker} != expected ${local.ticker}` };
  }
  return { ok: true };
}

/** Keputusan transisi murni — bisa di-unit-test. */
export function decideTransfiTopUpTransition(
  orderStatus: string,
  transfiStatus: TransfiOrderStatus,
): 'confirm' | 'expire-payment' | 'expire-crypto' | 'keep' | 'ignore' | 'complete' {
  const d = decideTransfiTransition(orderStatus, transfiStatus);
  if (d === 'confirm') return 'confirm';
  if (d === 'complete') return 'complete';
  if (d === 'expire') {
    return transfiStatus === 'asset_settle_failed' ? 'expire-crypto' : 'expire-payment';
  }
  return d; // keep | ignore
}

export async function processTransfiWebhook(payload: TransfiWebhookInput) {
  const { orderId, eventId, status } = payload;

  // Fast-path: already processed.
  const existing = await prisma.transfiWebhook.findUnique({
    where: { orderId_eventId: { orderId, eventId } },
  });
  if (existing?.processedAt) return { alreadyProcessed: true };

  // Find payment by provider order id.
  const payment = await prisma.payment.findUnique({
    where: { providerOrderId: orderId },
    include: { topUpOrder: true },
  });
  if (!payment) {
    await prisma.transfiWebhook.upsert({
      where: { orderId_eventId: { orderId, eventId } },
      create: { orderId, eventId, status, payload: JSON.stringify(payload), processedAt: new Date() },
      update: {},
    });
    return { notFound: true };
  }

  // Atomically claim webhook: insert if absent, or reuse unprocessed record.
  // Unique constraint guarantees duplicate webhooks never fulfill twice.
  let webhookRecord: Awaited<ReturnType<typeof prisma.transfiWebhook.upsert>>;
  try {
    webhookRecord = await prisma.transfiWebhook.upsert({
      where: { orderId_eventId: { orderId, eventId } },
      create: { orderId, eventId, paymentId: payment.id, status, payload: JSON.stringify(payload) },
      update: { paymentId: payment.id },
    });
  } catch (err: unknown) {
    // Unique race: another worker claimed it concurrently.
    const raced = await prisma.transfiWebhook.findUnique({
      where: { orderId_eventId: { orderId, eventId } },
    });
    if (raced?.processedAt) return { alreadyProcessed: true };
    throw err;
  }
  if (webhookRecord.processedAt) return { alreadyProcessed: true };

  const order = payment.topUpOrder;

  // Skip already-processed orders (but still mark webhook processed for consistency).
  if (!['CREATED', 'PAYMENT_PENDING', 'PAYMENT_CREATE_UNKNOWN', 'PAYMENT_CONFIRMED', 'CRYPTO_PROCESSING'].includes(order.status)) {
    await prisma.transfiWebhook.update({ where: { id: webhookRecord.id }, data: { processedAt: new Date() } });
    return { skipped: true };
  }

  // Webhook hanya sinyal — fulfillment via server-to-server GET (single path).
  const result = await verifyAndFulfillTopUp(order.publicId);
  await prisma.transfiWebhook.update({ where: { id: webhookRecord.id }, data: { processedAt: new Date() } }).catch(() => {});
  return result;
}

/**
 * Verifikasi server-to-server + fulfillment idempoten (§13/§20/§21).
 * dipakai webhook, payment-status endpoint, dan reconcile — ketiganya
 * konvergen ke state akhir yang sama apa pun urutan kedatangannya.
 *
 * TransFi direct-to-user settlement: fund_deposited → PAYMENT_CONFIRMED,
 * asset_settled → COMPLETED LANGSUNG. KORAMP TIDAK PERNAH memanggil
 * processCryptoDelivery untuk order TransFi (tidak ada pengiriman kedua).
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

  let verified: Awaited<ReturnType<typeof transfiGetOrder>>;
  try {
    verified = await transfiGetOrder(providerOrderId);
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

  const decision = decideTransfiTopUpTransition(order.status, verified.status);

  if (decision === 'keep') {
    return { state: 'PENDING' };
  }
  if (decision === 'ignore') {
    return { state: 'CONVERGED', status: order.status };
  }

  if (decision === 'expire-payment' || decision === 'expire-crypto') {
    const cryptoFailed = decision === 'expire-crypto';
    await prisma.$transaction(async (tx) => {
      await tx.payment.update({ where: { id: payment.id }, data: { status: 'EXPIRED' } });
      await tx.topUpOrder.update({
        where: { id: order.id },
        data: {
          status: cryptoFailed ? 'CRYPTO_FAILED' : 'PAYMENT_FAILED',
          failureReason: cryptoFailed ? 'Pengiriman kripto gagal. Hubungi support.' : 'QRIS expired. Buat order baru.',
        },
      });
    });
    return { state: 'EXPIRED' };
  }

  // decision === 'confirm' (fund_deposited): verifikasi penuh SEBELUM fulfill.
  // 1. Mode cocok (cegah campur sandbox/production).
  const expectedMode = (process.env.TRANSFI_MODE ?? 'sandbox').trim();
  const cfgModeOk = expectedMode === 'sandbox' || expectedMode === 'production';
  if (!cfgModeOk) {
    return { state: 'UNKNOWN', reason: 'transfi_mode_misconfigured' };
  }
  // 2. Amount + destination + ticker verification dari upstream (trusted source).
  // feeData.depositAmount harus == totalIdr KORAMP (exact int, tanpa toleransi).
  const localTotalIdr = Math.round(Number(order.totalIdr));
  const amountCheck = verifyTransfiAmounts(
    {
      totalIdr: localTotalIdr,
      destinationAddress: order.destinationAddress,
      ticker: transfiTickerForAsset(order.assetSymbol),
    },
    {
      fiatAmount: verified.feeData?.depositAmount,
      destinationWalletAddress: verified.walletAddress,
      cryptoTicker: undefined, // ticker validated at order creation; status GET may omit it
    },
  );
  if (!amountCheck.ok) {
    console.error(`[topup] transfi verification failed order=${order.publicId}: ${amountCheck.reason}`);
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
          provider: 'transfi',
          providerStatus: verified.status,
          providerFee: verified.feeData?.totalFee != null ? new Decimal(verified.feeData.totalFee) : undefined,
          providerRate: verified.feeData?.exchangeRate != null ? new Decimal(verified.feeData.exchangeRate) : undefined,
          providerQuote: verified.feeData ? JSON.stringify(verified.feeData) : undefined,
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
    // TIDAK ADA processCryptoDelivery — TransFi yang mengirim kripto ke user.
    return { state: 'CONFIRMED' };
  }

  // decision === 'complete' (asset_settled): verifikasi + COMPLETED langsung.
  // TIDAK ADA pengiriman kripto oleh KORAMP — settlement milik TransFi.
  const completed = await prisma.$transaction(async (tx) => {
    const current = await tx.topUpOrder.findUnique({ where: { id: order.id }, select: { status: true } });
    if (!current || !['CREATED', 'PAYMENT_PENDING', 'PAYMENT_CONFIRMED', 'CRYPTO_PROCESSING'].includes(current.status)) {
      return false;
    }
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'PAID',
        paidAt: new Date(),
        provider: 'transfi',
        providerStatus: verified.status,
        providerFee: verified.feeData?.totalFee != null ? new Decimal(verified.feeData.totalFee) : undefined,
        providerRate: verified.feeData?.exchangeRate != null ? new Decimal(verified.feeData.exchangeRate) : undefined,
        providerQuote: verified.feeData ? JSON.stringify(verified.feeData) : undefined,
        providerUpdatedAt: new Date(),
      },
    });
    await tx.topUpOrder.update({
      where: { id: order.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        action: 'ORDER_COMPLETED', entity: 'TopUpOrder', entityId: order.id,
        actor: order.walletAddress,
        metadata: JSON.stringify({ provider: 'transfi', providerOrderId, status: verified.status }),
      },
    });
    return true;
  });

  if (!completed) {
    const fresh = await prisma.topUpOrder.findUnique({ where: { id: order.id }, select: { status: true } });
    return { state: 'CONVERGED', status: fresh?.status ?? order.status };
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
    include: { withdrawal: true, payment: { select: { provider: true } } },
  });
  if (!order) return;
  // HARD GUARD: TransFi orders settle directly to the user wallet.
  // KORAMP must never broadcast a second delivery for them.
  if (shouldSkipKipremDelivery(order.payment?.provider)) return;
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
