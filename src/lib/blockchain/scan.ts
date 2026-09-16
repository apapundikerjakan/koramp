/**
 * Blockchain deposit scanner
 *
 * Scans a platform deposit address for incoming transactions matching
 * an expected amount. Used by:
 *  - Admin confirm-crypto (manual trigger)
 *  - Auto-poller API route (triggered by sell page + cron)
 *
 * SECURITY (P10):
 *  - Callers MUST verify sender == order.walletAddress (see poll-deposit route).
 *  - findIncomingTx accepts optional expectedSender and filters by it when provided.
 *  - Amount comparison uses Decimal with explicit tolerance (no parseFloat).
 *  - txHash uniqueness across orders is enforced by callers (DB lookup).
 *
 * PERFORMANCE (P11):
 *  - EVM uses pluggable HistorySource (Alchemy indexer when configured,
 *    else capped block-scan max 50 blocks per request).
 *  - Solana fetches last 20 signatures (unchanged, already bounded).
 */

import Decimal from 'decimal.js';
import type { TxInfo } from './types';
import type { NetworkId } from './index';

export interface ScanOpts {
  network: NetworkId;
  depositAddress: string;
  /** Decimal string — never float. */
  expectedAmount: string;
  asset: string;
  /** Optional: filter by sender (order.walletAddress). Strongly recommended for SELL. */
  expectedSender?: string;
  /** Amount tolerance as decimal string — HANYA untuk Solana. EVM selalu wei-exact (§7). */
  tolerance?: string;
  /** Lookback window in blocks (default 150, capped 200 by source). */
  maxBlocks?: number;
}

export function sameAddress(a: string, b: string): boolean {
  // EVM: case-insensitive. Solana: base58 case-sensitive, but compare exact.
  // Use case-insensitive for EVM (0x...), exact for others.
  if (a.startsWith('0x') && b.startsWith('0x')) return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

export function amountMatches(actual: string, expected: string, tolerance: string): boolean {
  try {
    const diff = new Decimal(actual).minus(new Decimal(expected)).abs();
    return diff.lte(new Decimal(tolerance));
  } catch {
    return false;
  }
}

// ─── Exact wei comparison (§7) ──────────────────────────────────────────────
// Native EVM deposits dibandingkan sebagai integer wei (exact), bukan desimal
// toleransi blanket. Default exact (toleranceWei '0'); toleransi hanya bila
// bisnis eksplisit membutuhkannya, dinyatakan dalam base unit.

export async function weiEquals(
  actualEth: string,
  expectedEth: string,
  toleranceWei = '0',
): Promise<boolean> {
  try {
    const { ethers } = await import('ethers');
    const a = ethers.parseEther(actualEth);
    const e = ethers.parseEther(expectedEth);
    const t = BigInt(toleranceWei);
    const diff = a >= e ? a - e : e - a;
    return diff <= t;
  } catch {
    return false;
  }
}

export type TxCheckReason =
  | 'tx_not_found'
  | 'tx_failed'
  | 'wrong_recipient'
  | 'sender_mismatch'
  | 'amount_mismatch';

/**
 * Satu pintu validasi tx-vs-order untuk SEMUA caller (submit-tx, poll-deposit,
 * cron, confirm-crypto, confirmed-sent). Tidak ada yang boleh menyimpan/
 * mengonfirmasi tx yang gagal di sini — receipt sukses adalah syarat mutlak.
 */
export async function validateTxForOrder(
  txInfo: TxInfo | null,
  opts: {
    depositAddress: string;
    walletAddress: string;
    expectedAmountEth: string;
    toleranceWei?: string;
  },
): Promise<{ ok: true } | { ok: false; reason: TxCheckReason; message: string }> {
  if (!txInfo) {
    return { ok: false, reason: 'tx_not_found', message: 'Transaksi tidak ditemukan di blockchain.' };
  }
  // FAILED (§8): receipt.status === 0 eksplisit. TxInfo lama tanpa txStatus
  // diperlakukan netral (tidak ditolak di sini) demi kompatibilitas.
  if (txInfo.txStatus === 'FAILED' || txInfo.receiptStatus === 0) {
    return { ok: false, reason: 'tx_failed', message: 'Transaksi GAGAL di blockchain (receipt status 0). Tidak bisa dipakai.' };
  }
  if (!sameAddress(txInfo.to, opts.depositAddress)) {
    return { ok: false, reason: 'wrong_recipient', message: 'Transaksi tidak dikirim ke alamat deposit order ini.' };
  }
  if (!sameAddress(txInfo.from, opts.walletAddress)) {
    return { ok: false, reason: 'sender_mismatch', message: 'Pengirim transaksi bukan wallet order ini.' };
  }
  if (!(await weiEquals(txInfo.amount, opts.expectedAmountEth, opts.toleranceWei ?? '0'))) {
    return {
      ok: false,
      reason: 'amount_mismatch',
      message: `Nominal tidak sama: diterima ${txInfo.amount}, diharapkan ${opts.expectedAmountEth}.`,
    };
  }
  return { ok: true };
}

/** Tracking state dari (confirmations, required) — satu definisi (§15). */
export function confirmationState(
  confirmations: number,
  required: number,
): 'DETECTED' | 'CONFIRMING' | 'CONFIRMED' {
  if (confirmations >= required) return 'CONFIRMED';
  if (confirmations > 0) return 'CONFIRMING';
  return 'DETECTED';
}

// ─── Structured scan logging (§25) ──────────────────────────────────────────
// Satu baris JSON per upaya tracking. TIDAK PERNAH: private key, secret,
// JWT, API key. Address/hash publik aman di-log (sudah publik di chain).

export interface ScanLog {
  orderId?: string;
  publicId?: string;
  network?: string;
  asset?: string;
  txHash?: string;
  source?: string;
  sender?: string;
  recipient?: string;
  expectedAmount?: string;
  actualAmount?: string;
  blockNumber?: number | null;
  confirmations?: number;
  requiredConfirmations?: number;
  state?: string;
  durationMs?: number;
  error?: string;
}

export function logScan(event: string, fields: ScanLog): void {
  try {
    // eslint-disable-next-line no-console
    console.info(JSON.stringify({ scope: 'deposit-scan', event, ...fields }));
  } catch { /* logging tidak boleh merusak flow */ }
}

/**
 * Find an incoming transaction to `depositAddress` matching `expectedAmount`.
 * When `expectedSender` is provided, only transactions FROM that sender match.
 * Returns the first confirmed match, or null if none found yet.
 */
export async function findIncomingTx(opts: ScanOpts): Promise<TxInfo | null> {
  const { network, depositAddress, expectedAmount, expectedSender } = opts;

  if (network === 'SOLANA') {
    return findSolanaIncoming(depositAddress, expectedAmount, expectedSender);
  } else {
    return findEvmIncoming(network, depositAddress, expectedAmount, expectedSender, opts.tolerance, opts.maxBlocks);
  }
}

// ─── Solana ───────────────────────────────────────────────────────────────────

async function findSolanaIncoming(
  depositAddress: string,
  expectedAmount: string,
  expectedSender?: string,
): Promise<TxInfo | null> {
  try {
    // Dynamic import — only runs server-side
    const { Connection, PublicKey, LAMPORTS_PER_SOL } = await import('@solana/web3.js');
    const { getSolanaRpcUrl } = await import('./network');

    const conn = new Connection(getSolanaRpcUrl(), 'confirmed');
    const pubkey = new PublicKey(depositAddress);

    // Fetch last 20 signatures for this address
    const sigs = await conn.getSignaturesForAddress(pubkey, { limit: 20 });
    const currentSlot = await conn.getSlot();

    for (const sig of sigs) {
      if (sig.err) continue;

      const tx = await conn.getTransaction(sig.signature, {
        maxSupportedTransactionVersion: 0,
      });
      if (!tx || tx.meta?.err) continue;

      // Calculate SOL received by depositAddress using Decimal (P23).
      const keys = tx.transaction.message.getAccountKeys?.()?.staticAccountKeys ?? [];
      const addrIndex = keys.findIndex((k) => k.toBase58() === depositAddress);
      if (addrIndex === -1) continue;

      const preBal = tx.meta?.preBalances?.[addrIndex] ?? 0;
      const postBal = tx.meta?.postBalances?.[addrIndex] ?? 0;
      const receivedLamports = new Decimal(postBal).minus(new Decimal(preBal));
      if (receivedLamports.lte(0)) continue;
      const received = receivedLamports.div(LAMPORTS_PER_SOL).toString();

      // Check amount matches with Decimal tolerance.
      if (!amountMatches(received, expectedAmount, '0.001')) continue;

      const from = keys[0]?.toBase58() ?? '';
      // Sender binding (P10): reject tx from wrong wallet.
      if (expectedSender && !sameAddress(from, expectedSender)) continue;

      const confirmations = Math.max(0, currentSlot - tx.slot);
      // Testnet: 5 confirmations; Production: 32
      const minConfs = process.env.NODE_ENV === 'production' ? 32 : 5;

      return {
        txHash: sig.signature,
        confirmations,
        isConfirmed: confirmations >= minConfs,
        amount: received,
        from,
        to: depositAddress,
        network: 'SOLANA',
      };
    }

    return null;
  } catch (err) {
    console.error('[scan] Solana scan error:', err);
    return null;
  }
}

// ─── EVM (Base / BSC) via pluggable HistorySource ────────────────────────────

async function findEvmIncoming(
  network: NetworkId,
  depositAddress: string,
  expectedAmount: string,
  expectedSender?: string,
  _tolerance = '0.0001',
  maxBlocks = 150,
): Promise<TxInfo | null> {
  const t0 = Date.now();
  const baseLog = { network, recipient: depositAddress, expectedAmount, sender: expectedSender };
  try {
    const { ethers } = await import('ethers');
    const { getBaseRpcUrl, getBscRpcUrl } = await import('./network');
    const { getHistorySource } = await import('./txIndex');
    const { toTxInfo } = await import('./evm');

    const rpc = network === 'BASE' ? getBaseRpcUrl() : getBscRpcUrl();
    const provider = new ethers.JsonRpcProvider(rpc);
    // Testnet: 3 confirmations; Production: Base=12, BSC=15
    const required =
      process.env.NODE_ENV === 'production' ? (network === 'BASE' ? 12 : 15) : 3;

    const source = getHistorySource(network);
    const scanWindow = { maxBlocks, timeoutMs: 20000 };
    logScan('scan_started', { ...baseLog, source: source.name });
    let candidates;
    try {
      candidates = await source.getRecentTransfers(network, depositAddress, scanWindow);
    } catch (idxErr) {
      logScan('indexer_failed', { ...baseLog, source: source.name, error: String(idxErr).slice(0, 160) });
      if (source.name === 'block-scan-fallback') return null;
      try {
        const { BlockScanHistorySource } = await import('./txIndex');
        candidates = await new BlockScanHistorySource().getRecentTransfers(network, depositAddress, scanWindow);
      } catch (fbErr) {
        logScan('fallback_failed', { ...baseLog, error: String(fbErr).slice(0, 160) });
        return null;
      }
    }

    const currentBlock = await provider.getBlockNumber().catch(() => 0);
    const chainId = await provider.getNetwork().then((n) => Number(n.chainId)).catch(() => 0);

    for (const c of candidates) {
      // §7: wei-exact (default), bukan toleransi desimal blanket.
      if (!(await weiEquals(c.valueEth, expectedAmount))) continue;
      if (expectedSender && !sameAddress(c.from, expectedSender)) continue;

      // §6: kandidat blok WAJIB lolos receipt — FAILED tidak pernah diterima.
      let inspected: TxInfo | null = null;
      try {
        const [tx, receipt] = await Promise.all([
          provider.getTransaction(c.hash),
          provider.getTransactionReceipt(c.hash),
        ]);
        inspected = toTxInfo({
          txHash: c.hash,
          tx: tx ? { value: tx.value, from: tx.from ?? undefined, to: tx.to ?? undefined } : null,
          receipt: receipt ? { status: receipt.status ?? null, blockNumber: receipt.blockNumber ?? null } : null,
          currentBlock,
          chainId,
          network,
          requiredConfirmations: required,
        });
      } catch {
        continue;
      }
      if (!inspected || inspected.txStatus === 'FAILED') continue;

      logScan('candidate_accepted', {
        ...baseLog,
        source: source.name,
        txHash: inspected.txHash,
        actualAmount: inspected.amount,
        blockNumber: inspected.blockNumber,
        confirmations: inspected.confirmations,
        requiredConfirmations: required,
        state: confirmationState(inspected.confirmations, required),
        durationMs: Date.now() - t0,
      });
      return inspected;
    }

    logScan('scan_empty', { ...baseLog, source: source.name, durationMs: Date.now() - t0 });
    return null;
  } catch (err) {
    logScan('scan_error', { ...baseLog, error: String(err).slice(0, 200), durationMs: Date.now() - t0 });
    return null;
  }
}
