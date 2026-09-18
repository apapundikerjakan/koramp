/**
 * Kipramp Pricing Engine
 *
 * ═══════════════════════════════════════════════════════════
 * FEE STRUCTURE — 3 POTONGAN, SAMA UNTUK TOP UP & SELL
 * ═══════════════════════════════════════════════════════════
 *
 * Semua potongan adalah PERSENTASE dari nilai GROSS (bruto):
 *   1. Biaya layanan:  gross × serviceFeeRate   (%, diatur di dashboard)
 *   2. Tax:            gross × taxRate           (%, diatur di dashboard)
 *   3. Biaya jaringan: gross × networkFeeRate   (%, diatur di dashboard)
 *  Total potongan = (1) + (2) + (3) — ditampilkan apa adanya di kalkulator.
 *
 * TOP UP (IDR → Crypto)  — BUYER pays all fees
 * ──────────────────────────────────────────────────────────
 *  User sends:     totalIdr  (what they type in)
 *  Exchange rate:  marketPrice × (1 + spread)   ← buyer gets worse rate
 *  Spendable:      totalIdr − serviceFee − tax − networkFee
 *  Crypto out:     spendable ÷ exchangeRate
 *
 * SELL (Crypto → IDR)  — SELLER pays all fees
 * ──────────────────────────────────────────────────────────
 *  Gross IDR:      cryptoAmount × exchangeRate (market × (1 − spread))
 *  IDR payout:     grossIdr − serviceFee − tax − networkFee
 *  Reverse (input IDR): grossIdr = (payout + networkFee) / (1 − rate − taxRate)
 *
 * ═══════════════════════════════════════════════════════════
 * PRICE SOURCE
 * ═══════════════════════════════════════════════════════════
 *  Live: CoinGecko public API (refreshed every 60s, cached in-memory)
 *  Fallback: admin-set SystemSetting (price_sol_idr, etc.)
 *  Last resort: hardcoded conservative values
 */

import Decimal from 'decimal.js';
import { prisma } from './prisma';
import { AppError } from './errors';
import { getLivePrice } from './marketPrice';
import { SUPPORTED_ASSETS, validateAssetNetwork as canonicalCheck } from './assets';

Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP });

export type AssetSymbol = 'SOL' | 'ETH' | 'BNB';
export type NetworkId = 'SOLANA' | 'BASE' | 'BSC';
export type OrderType = 'TOP_UP' | 'SELL';

export { SUPPORTED_ASSETS };

// ─── Network validation (canonical map lives in ./assets — no duplicate) ─────

export function validateAssetNetwork(asset: AssetSymbol, network: NetworkId) {
  if (!canonicalCheck(asset, network)) {
    const expected = SUPPORTED_ASSETS[asset]?.networkId ?? 'unknown';
    throw new AppError(
      400,
      'NETWORK_MISMATCH',
      `${asset} harus menggunakan jaringan ${expected}, bukan ${network}`,
    );
  }
}

export function getExpectedNetwork(asset: AssetSymbol): NetworkId {
  return SUPPORTED_ASSETS[asset].networkId;
}

// ─── Fee config ───────────────────────────────────────────────────────────────

interface FeeConfig {
  serviceFeeRate: Decimal; // e.g. 0.005 = 0.5%
  networkFeeRate: Decimal; // e.g. 0.001 = 0.1%
  taxRate: Decimal;        // e.g. 0.001 = 0.1%
  minOrderIdr: Decimal;
  maxOrderIdr: Decimal;
  // SOL ATA fee: biaya flat dalam SOL yang dipotong langsung dari crypto output
  // untuk memastikan transaksi tidak fail karena kurangnya rent exempt balance.
  // ATA (Associated Token Account) ~0.002 SOL di mainnet. Default 0 = tidak dipotong.
  solAtaFeeSol: Decimal;
}

async function getFeeConfig(asset: AssetSymbol, type: OrderType): Promise<FeeConfig> {
  const config = await prisma.feeConfig.findUnique({
    where: { assetSymbol_type: { assetSymbol: asset, type } },
  });
  return {
    serviceFeeRate: new Decimal(config?.serviceFeeRate?.toString() ?? '0.005'),
    networkFeeRate: new Decimal(config?.networkFeeRate?.toString() ?? '0.001'),
    taxRate:        new Decimal(config?.taxRate?.toString()        ?? '0.001'),
    minOrderIdr:    new Decimal(config?.minOrderIdr?.toString()    ?? '50000'),
    maxOrderIdr:    new Decimal(config?.maxOrderIdr?.toString()    ?? '100000000'),
    // solAtaFeeIdr in DB stores the SOL value (renamed conceptually — SOL units, not IDR)
    solAtaFeeSol:   new Decimal(config?.solAtaFeeIdr?.toString()   ?? '0'),
  };
}

// ─── Quote creation ───────────────────────────────────────────────────────────

export async function createQuote(
  type: OrderType,
  asset: AssetSymbol,
  network: NetworkId,
  idrAmount?: string,
  cryptoAmount?: string,
) {
  validateAssetNetwork(asset, network);

  // Strict numeric input validation (400, not 500 on garbage).
  const checkNumeric = (v: string | undefined, name: string, maxDecimals: number): Decimal | null => {
    if (v === undefined) return null;
    if (!/^\d+(\.\d{1,18})?$/.test(v.trim())) {
      throw new AppError(400, 'INVALID_INPUT', `${name} harus angka positif (max 18 desimal)`);
    }
    const d = new Decimal(v);
    if (!d.isFinite() || d.lte(0)) throw new AppError(400, 'INVALID_INPUT', `${name} harus > 0`);
    if ((v.split('.')[1]?.length ?? 0) > maxDecimals) {
      throw new AppError(400, 'INVALID_INPUT', `${name} max ${maxDecimals} desimal`);
    }
    return d;
  };
  checkNumeric(idrAmount, 'idrAmount', 2);
  checkNumeric(cryptoAmount, 'cryptoAmount', 8);

  const fee = await getFeeConfig(asset, type);

  // Live market price (CoinGecko → DB fallback → throw if unsafe)
  // Pass prisma for DB fallback in case CoinGecko is unreachable
  let marketPrice: Decimal;
  try {
    marketPrice = await getLivePrice(asset, prisma);
  } catch (e) {
    throw new AppError(503, 'PRICE_UNAVAILABLE', 'Harga pasar tidak tersedia — coba lagi sebentar');
  }

  const assetRecord = await prisma.asset.findUnique({ where: { symbol: asset } });
  if (!assetRecord) throw new AppError(404, 'ASSET_NOT_FOUND', `Aset ${asset} tidak ditemukan`);

  const SPREAD = new Decimal('0.005'); // 0.5% spread applied to BOTH directions

  let idr: Decimal;
  let crypto: Decimal;
  let serviceFee: Decimal;
  let networkFee: Decimal;
  let tax: Decimal;
  let totalIdr: Decimal;
  let exchangeRate: Decimal;

  // Guard: gabungan rate % tidak boleh menghabiskan gross (admin dibatasi
  // max 10% per rate di API, tapi tetap cegah pembagian nol di Mode B).
  if (fee.serviceFeeRate.plus(fee.taxRate).plus(fee.networkFeeRate).gte(1)) {
    throw new AppError(400, 'INVALID_FEE', 'Total rate fee + tax + network tidak valid');
  }

  if (type === 'TOP_UP') {
    // ── TOP UP: buyer pays fees ──────────────────────────────────────────────
    // User inputs: idrAmount (total they will pay)
    // Exchange rate is WORSE for buyer (spread added)
    if (!idrAmount) throw new AppError(400, 'INVALID_INPUT', 'idrAmount diperlukan untuk TOP_UP');

    totalIdr = new Decimal(idrAmount).toDecimalPlaces(2, Decimal.ROUND_FLOOR);

    if (totalIdr.lt(fee.minOrderIdr)) {
      throw new AppError(400, 'BELOW_MIN', `Minimum order Rp${fee.minOrderIdr.toFixed(0)}`);
    }
    if (totalIdr.gt(fee.maxOrderIdr)) {
      throw new AppError(400, 'ABOVE_MAX', `Maximum order Rp${fee.maxOrderIdr.toFixed(0)}`);
    }

    // Buyer rate = market + spread (worse for buyer)
    exchangeRate = marketPrice.mul(new Decimal(1).plus(SPREAD)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    // Service fee + tax + network (% dari gross)
    serviceFee = totalIdr.mul(fee.serviceFeeRate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    tax        = totalIdr.mul(fee.taxRate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    networkFee = totalIdr.mul(fee.networkFeeRate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    // What's left after fees is used to buy crypto
    const spendable = totalIdr.minus(serviceFee).minus(tax).minus(networkFee);
    if (spendable.lte(0)) {
      throw new AppError(400, 'AMOUNT_TOO_LOW', 'Nominal terlalu kecil setelah biaya dipotong');
    }

    // Calculate raw crypto before ATA deduction
    const cryptoRaw = spendable.div(exchangeRate).toDecimalPlaces(8, Decimal.ROUND_FLOOR);

    // SOL ATA fee: potong flat SOL langsung dari crypto output (bukan dari IDR).
    // User menerima cryptoRaw - solAtaFeeSol SOL.
    // Ini memastikan platform punya cukup SOL untuk membayar rent ATA jika diperlukan.
    const ataFeeSol = asset === 'SOL' ? fee.solAtaFeeSol : new Decimal(0);
    if (ataFeeSol.gt(0) && cryptoRaw.lte(ataFeeSol)) {
      throw new AppError(400, 'AMOUNT_TOO_LOW', 'Nominal terlalu kecil setelah biaya ATA dipotong');
    }

    crypto = cryptoRaw.minus(ataFeeSol).toDecimalPlaces(8, Decimal.ROUND_FLOOR);
    idr = totalIdr;

  } else {
    // ── SELL: seller pays fees ───────────────────────────────────────────────
    // Two input modes:
    //   A) cryptoAmount → compute gross IDR then deduct fees → totalIdr (payout)
    //   B) idrAmount (desired payout) → reverse-compute the crypto they must send
    //      crypto = desiredPayout / (exchangeRate × (1 − rate − taxRate − networkRate))

    // Seller rate = market − spread (worse for seller), same for both modes
    exchangeRate = marketPrice.mul(new Decimal(1).minus(SPREAD)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    if (idrAmount && !cryptoAmount) {
      // ── Mode B: user specifies desired IDR payout ──────────────────────────
      const desiredPayout = new Decimal(idrAmount).toDecimalPlaces(2, Decimal.ROUND_FLOOR);

      if (desiredPayout.lt(fee.minOrderIdr)) {
        throw new AppError(400, 'BELOW_MIN', `Minimum payout Rp${fee.minOrderIdr.toFixed(0)}`);
      }
      if (desiredPayout.gt(fee.maxOrderIdr)) {
        throw new AppError(400, 'ABOVE_MAX', `Maximum payout Rp${fee.maxOrderIdr.toFixed(0)}`);
      }

      // Reverse formula:
      //   grossIdr × (1 − serviceFeeRate − taxRate − networkFeeRate) = desiredPayout
      //   grossIdr = desiredPayout / (1 − serviceFeeRate − taxRate − networkFeeRate)
      const grossIdr = desiredPayout
        .div(new Decimal(1).minus(fee.serviceFeeRate).minus(fee.taxRate).minus(fee.networkFeeRate))
        .toDecimalPlaces(2, Decimal.ROUND_UP);

      // Validate limits on gross IDR
      if (grossIdr.gt(fee.maxOrderIdr)) {
        throw new AppError(400, 'ABOVE_MAX', `Maximum order Rp${fee.maxOrderIdr.toFixed(0)}`);
      }

      serviceFee = grossIdr.mul(fee.serviceFeeRate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      tax        = grossIdr.mul(fee.taxRate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      networkFee = grossIdr.mul(fee.networkFeeRate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      totalIdr   = desiredPayout; // This is the net the seller receives
      idr        = grossIdr;      // Gross IDR stored in idrAmount field

      // Crypto the user must send (rounded UP so platform never loses)
      crypto = grossIdr.div(exchangeRate).toDecimalPlaces(8, Decimal.ROUND_UP);

    } else {
      // ── Mode A: user specifies crypto amount ───────────────────────────────
      if (!cryptoAmount) throw new AppError(400, 'INVALID_INPUT', 'cryptoAmount atau idrAmount diperlukan untuk SELL');

      crypto = new Decimal(cryptoAmount).toDecimalPlaces(8, Decimal.ROUND_FLOOR);
      if (crypto.lte(0)) throw new AppError(400, 'INVALID_AMOUNT', 'Jumlah crypto harus lebih dari 0');

      // Gross IDR before fees
      const grossIdr = crypto.mul(exchangeRate).toDecimalPlaces(2, Decimal.ROUND_FLOOR);

      // Validate against order limits using gross IDR
      if (grossIdr.lt(fee.minOrderIdr)) {
        const minCrypto = fee.minOrderIdr.div(exchangeRate).toDecimalPlaces(8, Decimal.ROUND_UP);
        throw new AppError(
          400,
          'BELOW_MIN',
          `Minimum order Rp${fee.minOrderIdr.toFixed(0)} (≈ ${minCrypto.toFixed(6)} ${asset})`,
        );
      }
      if (grossIdr.gt(fee.maxOrderIdr)) {
        throw new AppError(400, 'ABOVE_MAX', `Maximum order Rp${fee.maxOrderIdr.toFixed(0)}`);
      }

      serviceFee = grossIdr.mul(fee.serviceFeeRate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      tax        = grossIdr.mul(fee.taxRate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      networkFee = grossIdr.mul(fee.networkFeeRate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      totalIdr   = grossIdr.minus(serviceFee).minus(tax).minus(networkFee).toDecimalPlaces(2, Decimal.ROUND_FLOOR);
      if (totalIdr.lte(0)) {
        throw new AppError(400, 'AMOUNT_TOO_LOW', 'Nominal terlalu kecil setelah biaya dipotong');
      }
      idr = grossIdr;
    } // end Mode A
  } // end SELL

  const rawTtl = Number(process.env.QUOTE_TTL_SECONDS ?? '120');
  const ttl = Number.isFinite(rawTtl) ? Math.min(3600, Math.max(10, Math.floor(rawTtl))) : 120;
  const expiresAt = new Date(Date.now() + ttl * 1000);

  const quote = await prisma.quote.create({
    data: {
      type,
      assetId: assetRecord.id,
      assetSymbol: asset,
      network,
      idrAmount:    idr,
      cryptoAmount: crypto,
      marketPrice,
      spread:       SPREAD,
      serviceFee,
      networkFee,
      tax,
      taxRate:      fee.taxRate,
      totalIdr,
      expiresAt,
    },
  });

  return {
    quoteId:      quote.id,
    type,
    asset,
    network,
    marketPrice:  marketPrice.toFixed(2),
    exchangeRate: exchangeRate.toFixed(2),
    idrAmount:    idr.toFixed(2),
    cryptoAmount: crypto.toFixed(8),
    serviceFee:   serviceFee.toFixed(2),
    serviceFeeRate: fee.serviceFeeRate.toString(),
    networkFee:   networkFee.toFixed(2),
    networkFeeRate: fee.networkFeeRate.toString(),
    tax:          tax.toFixed(2),
    taxRate:      fee.taxRate.toString(),
    totalIdr:     totalIdr.toFixed(2),
    // SOL ATA fee in SOL units — shown in quote so frontend can display "termasuk biaya ATA"
    solAtaFeeSol: (asset === 'SOL' && type === 'TOP_UP') ? fee.solAtaFeeSol.toFixed(8) : '0',
    expiresAt:    expiresAt.toISOString(),
  };
}

// ─── Quote validation ─────────────────────────────────────────────────────────

export async function validateAndUseQuote(quoteId: string, type: OrderType) {
  const now = new Date();
  // Atomic consumption: only one request can claim a quote.
  // WHERE usedAt IS NULL AND expiresAt > now AND type matches.
  const claimed = await prisma.quote.updateMany({
    where: {
      id: quoteId,
      type,
      usedAt: null,
      expiresAt: { gt: now },
    },
    data: { usedAt: now },
  });

  if (claimed.count === 0) {
    // Determine why it failed for a precise error (without racing).
    const q = await prisma.quote.findUnique({ where: { id: quoteId } });
    if (!q) throw new AppError(404, 'NOT_FOUND', 'Quote tidak ditemukan');
    if (q.type !== type) throw new AppError(400, 'QUOTE_TYPE_MISMATCH', 'Tipe quote tidak sesuai');
    if (q.usedAt) throw new AppError(410, 'QUOTE_USED', 'Quote sudah digunakan');
    if (now > q.expiresAt) {
      throw new AppError(410, 'QUOTE_EXPIRED', 'Quote sudah kedaluwarsa. Silakan minta quote baru.');
    }
    // Race lost (another request claimed it concurrently).
    throw new AppError(410, 'QUOTE_USED', 'Quote sudah digunakan (concurrent)');
  }

  const q = await prisma.quote.findUnique({ where: { id: quoteId } });
  if (!q) throw new AppError(404, 'NOT_FOUND', 'Quote tidak ditemukan');
  return q;
}
