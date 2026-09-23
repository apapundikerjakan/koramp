/**
 * Reward LIVE payout engine (Phase 3B).
 *
 * DORMANT unless REWARD_PAYOUT_MODE=live. Safe default: disabled.
 * - Treasury keys: server env only, never logged/stored/returned.
 * - Isolated from the SELL/platform payout system (own signers, own flow).
 * - NATIVE transfers only; any other token config → STOP (no fallback).
 * - Amounts fixed at PROCESSING; retries reuse stored amounts.
 * - UNKNOWN broadcast state → FAILED+BROADCAST_UNKNOWN, reconcile-only.
 */

import Decimal from 'decimal.js';
import { ethers } from 'ethers';
import { Connection, PublicKey, Keypair, SystemProgram, Transaction } from '@solana/web3.js';
import { prisma } from '@/lib/prisma';
import { sameWallet } from '@/lib/support';
import { getRewardConfig, isCompatibleWallet } from '@/lib/rewards';
import { SOLANA_GENESIS_HASHES } from '@/lib/blockchain/network';
import {
  getPayoutAdapter,
  fetchUsdRateFresh,
  toBaseUnits,
  type PayoutMode,
} from '@/lib/rewardPayout';
import { AppError } from '@/lib/errors';

// bs58 v5+ ESM interop (same pattern as blockchain/solana.ts).
const _bs58mod = require('bs58') as {
  decode?: (input: string) => Uint8Array;
  default?: { decode(input: string): Uint8Array };
};
const bs58 = _bs58mod.default ?? (_bs58mod as unknown as { decode(input: string): Uint8Array });

export function getLivePayoutMode(): PayoutMode | 'live' {
  const m = (process.env.REWARD_PAYOUT_MODE ?? 'disabled').trim().toLowerCase();
  if (m === 'live') return 'live';
  return m === 'dry-run' ? 'dry-run' : 'disabled';
}

/** Throws unless live mode is explicitly enabled. */
export function assertLiveEnabled(): void {
  if (getLivePayoutMode() !== 'live') {
    throw new AppError(503, 'PAYOUT_NOT_LIVE', 'Live payout is not enabled.');
  }
}

/**
 * Per-network live confirmation (§2 env isolation).
 * REWARD_PAYOUT_MODE=live alone is NOT enough: the deployment must also set
 * REWARD_LIVE_CONFIRM to the exact network being paid (SOLANA|BNB|BASE).
 * Prevents one stray variable — or a shared env file — from activating
 * payouts on an unintended network.
 */
export function assertLiveNetwork(network: string): void {
  const confirm = (process.env.REWARD_LIVE_CONFIRM ?? '').trim().toUpperCase();
  if (confirm !== network.toUpperCase()) {
    throw new AppError(503, 'PAYOUT_NOT_CONFIRMED', `Live payout for ${network} is not confirmed by environment.`);
  }
}

// ─── Configuration (server env only) ──────────────────────────────────────

const KEY_ENV: Record<string, string> = {
  SOLANA: 'SOLANA_REWARD_TREASURY_PRIVATE_KEY',
  BNB: 'BNB_REWARD_TREASURY_PRIVATE_KEY',
  BASE: 'BASE_REWARD_TREASURY_PRIVATE_KEY',
};
// Local dev/testnet mapping: when dedicated reward keys are absent, the
// reward treasury resolves to the SAME platform hot wallet (network-specific).
// No secret is duplicated — this is a reference, values stay in one place.
const PLATFORM_KEY_ENV: Record<string, string> = {
  SOLANA: 'SOLANA_PLATFORM_PRIVATE_KEY',
  BNB: 'BSC_PLATFORM_PRIVATE_KEY',
  BASE: 'BASE_PLATFORM_PRIVATE_KEY',
};
const ADDR_ENV: Record<string, string> = {
  SOLANA: 'SOLANA_REWARD_TREASURY_ADDRESS',
  BNB: 'BNB_REWARD_TREASURY_ADDRESS',
  BASE: 'BASE_REWARD_TREASURY_ADDRESS',
};
const TOKEN_ENV: Record<string, string> = {
  SOLANA: 'SOLANA_REWARD_TOKEN',
  BNB: 'BNB_REWARD_TOKEN',
  BASE: 'BASE_REWARD_TOKEN',
};
const RPC_ENV: Record<string, string> = {
  SOLANA: 'SOLANA_RPC_URL',
  BNB: 'BSC_RPC_URL',
  BASE: 'BASE_RPC_URL',
};

export interface LivePrereqs {
  token: string;
  treasuryAddress: string;
  treasuryKeySource: string; // which env var supplied the key (name only, never value)
  rpcUrl: string;
}

/**
 * Resolve the treasury signing key: dedicated reward key first, platform hot
 * wallet second (network-specific). Throws when neither exists.
 */
export function resolveTreasuryKey(network: string): { key: string; source: string } {
  const direct = (process.env[KEY_ENV[network]] ?? '').trim();
  if (direct) return { key: direct, source: KEY_ENV[network] };
  const platform = (process.env[PLATFORM_KEY_ENV[network]] ?? '').trim();
  if (platform) return { key: platform, source: PLATFORM_KEY_ENV[network] };
  throw new AppError(500, 'CONFIG_ERROR', `Treasury key for ${network} missing.`);
}

/** Derive the wallet address from a raw key (no network calls, no logging). */
export function deriveTreasuryAddress(network: string, key: string): string {
  try {
    if (network === 'SOLANA') {
      return Keypair.fromSecretKey(bs58.decode(key)).publicKey.toBase58();
    }
    return new ethers.Wallet(key).address;
  } catch {
    throw new AppError(500, 'CONFIG_ERROR', 'Invalid treasury key format.');
  }
}

/** Validate all live prerequisites. Throws CONFIG_ERROR on any gap. */
export function checkLivePrereqs(network: string): LivePrereqs {
  const token = (process.env[TOKEN_ENV[network]] ?? 'NATIVE').trim().toUpperCase();
  if (token !== 'NATIVE') {
    throw new AppError(500, 'CONFIG_ERROR', `Reward token for ${network} is not NATIVE — STOP, no fallback.`);
  }
  const treasuryAddress = (process.env[ADDR_ENV[network]] ?? '').trim();
  if (!treasuryAddress) throw new AppError(500, 'CONFIG_ERROR', `Treasury address for ${network} missing.`);
  const { key, source } = resolveTreasuryKey(network);
  // Signer must match the configured treasury address (derived locally).
  const derived = deriveTreasuryAddress(network, key);
  const norm = (a: string) => a.toLowerCase();
  if (norm(derived) !== norm(treasuryAddress)) {
    throw new AppError(500, 'CONFIG_ERROR', 'Signer does not match treasury address — STOP.');
  }
  const rpcUrl = (process.env[RPC_ENV[network]] ?? '').trim();
  if (!rpcUrl || !/^https:\/\//.test(rpcUrl)) throw new AppError(500, 'CONFIG_ERROR', `RPC URL for ${network} invalid.`);
  return { token, treasuryAddress, treasuryKeySource: source, rpcUrl };
}

/** Load signer and verify derived address matches configured treasury. NEVER log/return key. */
function loadSolanaSigner(network: string, treasuryAddress: string): Keypair {
  const { key } = resolveTreasuryKey(network);
  let kp: Keypair;
  try {
    kp = Keypair.fromSecretKey(bs58.decode(key));
  } catch {
    throw new AppError(500, 'CONFIG_ERROR', 'Invalid treasury key format.');
  }
  if (kp.publicKey.toBase58().toLowerCase() !== treasuryAddress.toLowerCase()) {
    throw new AppError(500, 'CONFIG_ERROR', 'Signer does not match treasury address — STOP.');
  }
  return kp;
}

function loadEvmSigner(network: string, treasuryAddress: string, rpcUrl: string): ethers.Wallet {
  const { key } = resolveTreasuryKey(network);
  let wallet: ethers.Wallet;
  try {
    wallet = new ethers.Wallet(key, new ethers.JsonRpcProvider(rpcUrl));
  } catch {
    throw new AppError(500, 'CONFIG_ERROR', 'Invalid treasury key format.');
  }
  if (wallet.address.toLowerCase() !== treasuryAddress.toLowerCase()) {
    throw new AppError(500, 'CONFIG_ERROR', 'Signer does not match treasury address — STOP.');
  }
  return wallet;
}

// ─── Testnet enforcement (broadcast path only) ──────────────────────────────
// Live broadcast is TESTNET-ONLY in this phase. Three independent layers:
// 1. RPC URL backstop (rejects known mainnet endpoints),
// 2. EVM chainId verification against expected testnet chain,
// 3. Solana genesis-hash verification (devnet only).
// A mainnet RPC/key can never slip through silently — mismatch = safe error.

const MAINNET_RPC_PATTERNS = [
  /mainnet-beta/i,
  /api\.mainnet/i,
  /bsc-dataseed/i,
  /mainnet\.base\.org/i,
  /eth-mainnet/i,
];

const TESTNET_CHAIN_IDS: Record<string, number> = { BASE: 84532, BNB: 97 };

export function assertTestnetRpcUrl(network: string, rpcUrl: string): void {
  for (const p of MAINNET_RPC_PATTERNS) {
    if (p.test(rpcUrl)) {
      throw new AppError(500, 'CONFIG_ERROR', `Mainnet RPC rejected for ${network} — testnet only.`);
    }
  }
}

export async function verifyEvmTestnetChain(
  provider: { getNetwork(): Promise<{ chainId: bigint | number }> },
  network: 'BASE' | 'BNB',
): Promise<void> {
  const expected = TESTNET_CHAIN_IDS[network];
  let chainId: bigint | number;
  try {
    ({ chainId } = await provider.getNetwork());
  } catch {
    throw new AppError(502, 'RPC_UNAVAILABLE', 'Chain verification failed — retry later.');
  }
  if (Number(chainId) !== expected) {
    throw new AppError(500, 'CONFIG_ERROR', `Wrong chain for ${network}: got ${String(chainId)}, expected testnet ${expected}.`);
  }
}

export async function verifySolanaDevnet(
  connection: { getGenesisHash(): Promise<string> },
): Promise<void> {
  let hash: string;
  try {
    hash = await connection.getGenesisHash();
  } catch {
    throw new AppError(502, 'RPC_UNAVAILABLE', 'Cluster verification failed — retry later.');
  }
  if (hash !== SOLANA_GENESIS_HASHES.devnet) {
    throw new AppError(500, 'CONFIG_ERROR', 'Wrong Solana cluster — devnet only.');
  }
}

// ─── Broadcast (live only — callers must assertLiveEnabled first) ──────────

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('BROADCAST_TIMEOUT')), ms)),
  ]);
}

async function broadcastSolana(rpcUrl: string, signer: Keypair, to: string, lamports: string): Promise<string> {
  const conn = new Connection(rpcUrl, { commitment: 'confirmed', disableRetryOnRateLimit: false });
  const { blockhash } = await withTimeout(conn.getLatestBlockhash('confirmed'), 20000);
  const tx = new Transaction({ recentBlockhash: blockhash, feePayer: signer.publicKey }).add(
    SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey: new PublicKey(to), lamports: Number(lamports) }),
  );
  tx.sign(signer);
  const rawTx = tx.serialize();
  return withTimeout(
    conn.sendRawTransaction(rawTx, { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3 }),
    30000,
  );
}

async function broadcastEvm(wallet: ethers.Wallet, to: string, wei: string): Promise<string> {
  const tx = await withTimeout(
    wallet.sendTransaction({ to, value: BigInt(wei) }),
    30000,
  );
  return tx.hash;
}

// ─── Confirmation ─────────────────────────────────────────────────────────

export type ConfirmResult = 'CONFIRMED' | 'PENDING' | 'FAILED' | 'UNKNOWN';

async function confirmSolana(rpcUrl: string, signature: string): Promise<ConfirmResult> {
  const conn = new Connection(rpcUrl, { commitment: 'confirmed', disableRetryOnRateLimit: false });
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    try {
      const { value } = await conn.getSignatureStatuses([signature], { searchTransactionHistory: true });
      const st = value[0];
      const s = st?.confirmationStatus;
      if (s === 'confirmed' || s === 'finalized') return 'CONFIRMED';
      if (st?.err) return 'FAILED';
    } catch {
      return 'UNKNOWN';
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return 'UNKNOWN';
}

async function confirmEvm(wallet: ethers.Wallet, hash: string): Promise<ConfirmResult> {
  if (!wallet.provider) return 'UNKNOWN';
  try {
    const receipt = await wallet.provider.waitForTransaction(hash, 1, 120000);
    if (!receipt) return 'UNKNOWN';
    return receipt.status === 1 ? 'CONFIRMED' : 'FAILED';
  } catch {
    return 'UNKNOWN';
  }
}

// ─── Failure taxonomy ─────────────────────────────────────────────────────

export const RETRYABLE_FAILURES = new Set([
  'BROADCAST_FAILED',
  'RATE_UNAVAILABLE',
  'RPC_UNAVAILABLE',
  'INSUFFICIENT_BALANCE',
  'INSUFFICIENT_GAS',
  'FEE_ESTIMATE_FAILED',
  'CONFIG_ERROR',
]);

export const MAX_ATTEMPTS = 3;

// ─── Executor ─────────────────────────────────────────────────────────────

export interface ExecuteOutcome {
  status: string;
  txHash: string | null;
  failureReason: string | null;
}

/**
 * Execute live payout for a claim. Caller: admin-triggered endpoint only.
 * Amounts fixed at PROCESSING; reused on retry. UNKNOWN → FAILED +
 * BROADCAST_UNKNOWN (reconcile-only, never blind retry).
 */
export async function executeRewardPayout(claimId: string): Promise<ExecuteOutcome> {
  assertLiveEnabled();
  const claim = await prisma.rewardClaim.findUnique({ where: { id: claimId } });
  if (!claim) throw new AppError(404, 'CLAIM_NOT_FOUND', 'Klaim tidak ditemukan.');
  assertLiveNetwork(claim.network);

  const retryableFailed =
    claim.status === 'FAILED' && claim.failureReason && RETRYABLE_FAILURES.has(claim.failureReason);
  if (claim.status !== 'PENDING_PAYOUT' && !retryableFailed) {
    throw new AppError(409, 'CLAIM_NOT_RUNNABLE', `Klaim berstatus ${claim.status}.`);
  }
  if (claim.attemptCount >= MAX_ATTEMPTS) {
    throw new AppError(409, 'MAX_ATTEMPTS', 'Batas percobaan tercapai — rekonsiliasi manual.');
  }

  // Atomic lock (only one executor wins).
  const locked = await prisma.rewardClaim.updateMany({
    where: { id: claim.id, status: claim.status },
    data: { status: 'PROCESSING', attemptCount: { increment: 1 } },
  });
  if (locked.count !== 1) {
    const cur = await prisma.rewardClaim.findUnique({ where: { id: claim.id }, select: { status: true, txHash: true, failureReason: true } });
    return { status: cur?.status ?? 'PROCESSING', txHash: cur?.txHash ?? null, failureReason: cur?.failureReason ?? null };
  }

  const fail = async (reason: string): Promise<ExecuteOutcome> => {
    await prisma.rewardClaim.update({ where: { id: claim.id }, data: { status: 'FAILED', failureReason: reason } });
    await audit(claim.publicId, 'REWARD_PAYOUT_FAILED', { reason });
    return { status: 'FAILED', txHash: claim.txHash, failureReason: reason };
  };

  try {
    await audit(claim.publicId, 'REWARD_PAYOUT_STARTED', { network: claim.network });
    // Re-validate (never trust stored values blindly).
    if (!sameWallet(claim.destWallet, claim.walletAddress)) return fail('VALIDATION_FAILED');
    if (!isCompatibleWallet(claim.network, claim.destWallet)) return fail('VALIDATION_FAILED');
    const cfg = await getRewardConfig();
    if (!cfg.networks.includes(claim.network)) return fail('VALIDATION_FAILED');
    const adapter = getPayoutAdapter(claim.network);
    const pre = checkLivePrereqs(claim.network);

    // Amounts: reuse finalized quote if present, else compute fresh ONCE.
    let tokenAmount = claim.tokenAmount;
    let baseUnits = claim.baseUnits;
    let rateUsd = claim.rateUsd;
    let rateSource = claim.rateSource;
    let rateTimestamp = claim.rateTimestamp;
    if (!tokenAmount || !baseUnits || !rateUsd) {
      // Fresh rate — never settle a live payout on a cached price.
      const rate = await fetchUsdRateFresh(adapter.geckoId);
      if (!rate) return fail('RATE_UNAVAILABLE');
      const now = new Date();
      tokenAmount = new Decimal(claim.rewardUsd.toString()).div(rate).toFixed(adapter.decimals);
      baseUnits = toBaseUnits(claim.rewardUsd.toString(), rate, adapter.decimals);
      rateUsd = rate.toString();
      rateSource = `coingecko:${adapter.geckoId}/usd`;
      rateTimestamp = now;
      await prisma.rewardClaim.updateMany({
        where: { id: claim.id, status: 'PROCESSING' },
        data: {
          token: adapter.asset, tokenAmount, baseUnits, rateUsd, rateSource, rateTimestamp,
        },
      });
    }

    // Treasury balance (native covers amount + gas for NATIVE payouts).
    if (claim.network === 'SOLANA') {
      const conn = new Connection(pre.rpcUrl, { commitment: 'confirmed' });
      const signer = loadSolanaSigner(claim.network, pre.treasuryAddress);
      let lamports: number;
      try {
        lamports = await conn.getBalance(signer.publicKey);
      } catch {
        return fail('RPC_UNAVAILABLE');
      }
      if (new Decimal(lamports).lt(new Decimal(baseUnits).plus(10000))) return fail('INSUFFICIENT_BALANCE');
      // Testnet enforcement BEFORE any signing/broadcast.
      assertTestnetRpcUrl(claim.network, pre.rpcUrl);
      try {
        const testConn = new Connection(pre.rpcUrl, { commitment: 'confirmed' });
        await verifySolanaDevnet(testConn);
      } catch (e) {
        if (e instanceof AppError && e.code === 'CONFIG_ERROR') return fail('CONFIG_ERROR');
        return fail('RPC_UNAVAILABLE');
      }
      let signature: string;
      try {
        signature = await broadcastSolana(pre.rpcUrl, signer, claim.destWallet, baseUnits);
      } catch (e) {
        const msg = e instanceof Error ? e.message : '';
        if (/timeout/i.test(msg) || /TIMEOUT/.test(msg)) return unknownState(claim.id, claim.publicId, null);
        return fail('BROADCAST_FAILED');
      }
      return settleSolana(claim.id, claim.publicId, pre.rpcUrl, signature);
    }

    // EVM (BASE/BNB).
    const wallet = loadEvmSigner(claim.network, pre.treasuryAddress, pre.rpcUrl);
    // Testnet enforcement BEFORE any signing/broadcast.
    assertTestnetRpcUrl(claim.network, pre.rpcUrl);
    try {
      await verifyEvmTestnetChain(wallet.provider!, claim.network as 'BASE' | 'BNB');
    } catch (e) {
      if (e instanceof AppError && e.code === 'CONFIG_ERROR') return fail('CONFIG_ERROR');
      return fail('RPC_UNAVAILABLE');
    }
    let fee: { gas: bigint; price: bigint };
    try {
      const [est, feeData] = await Promise.all([
        wallet.provider!.estimateGas({ to: claim.destWallet, value: BigInt(baseUnits) }),
        wallet.provider!.getFeeData(),
      ]);
      const price = feeData.maxFeePerGas ?? feeData.gasPrice;
      if (!price) throw new Error('no fee');
      fee = { gas: est, price };
    } catch {
      return fail('FEE_ESTIMATE_FAILED');
    }
    try {
      const bal: bigint = await wallet.provider!.getBalance(wallet.address);
      if (bal < BigInt(baseUnits) + fee.gas * fee.price) return fail('INSUFFICIENT_BALANCE');
    } catch {
      return fail('RPC_UNAVAILABLE');
    }
    let hash: string;
    try {
      hash = await broadcastEvm(wallet, claim.destWallet, baseUnits);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (/timeout/i.test(msg) || /TIMEOUT/.test(msg)) return unknownState(claim.id, claim.publicId, null);
      return fail('BROADCAST_FAILED');
    }
    return settleEvm(claim.id, claim.publicId, wallet, hash);
  } catch (e) {
    if (e instanceof AppError && e.code === 'CONFIG_ERROR') return fail('CONFIG_ERROR');
    if (e instanceof AppError) throw e;
    return fail('BROADCAST_FAILED');
  }
}

async function audit(entityId: string, action: string, metadata: Record<string, unknown>): Promise<void> {
  try {
    await prisma.auditLog.create({ data: { action, entity: 'RewardClaim', entityId, actor: 'admin', metadata: JSON.stringify(metadata) } });
  } catch {}
}

async function unknownState(claimId: string, publicId: string, txHash: string | null): Promise<ExecuteOutcome> {
  await prisma.rewardClaim.update({
    where: { id: claimId },
    data: { status: 'FAILED', failureReason: 'BROADCAST_UNKNOWN', ...(txHash ? { txHash } : {}) },
  });
  await audit(publicId, 'REWARD_PAYOUT_FAILED', { reason: 'BROADCAST_UNKNOWN' });
  return { status: 'FAILED', txHash, failureReason: 'BROADCAST_UNKNOWN' };
}

async function settleSolana(claimId: string, publicId: string, rpcUrl: string, signature: string): Promise<ExecuteOutcome> {
  await prisma.rewardClaim.updateMany({
    where: { id: claimId, status: 'PROCESSING', txHash: null },
    data: { status: 'SUBMITTED', txHash: signature, submittedAt: new Date() },
  });
  await audit(publicId, 'REWARD_PAYOUT_SUBMITTED', { txHash: signature });
  const res = await confirmSolana(rpcUrl, signature);
  if (res === 'CONFIRMED') {
    await prisma.rewardClaim.update({ where: { id: claimId }, data: { status: 'PAID', confirmedAt: new Date() } });
    await audit(publicId, 'REWARD_PAYOUT_CONFIRMED', { txHash: signature });
    return { status: 'PAID', txHash: signature, failureReason: null };
  }
  if (res === 'FAILED') {
    await prisma.rewardClaim.update({ where: { id: claimId }, data: { status: 'FAILED', failureReason: 'TX_REVERTED' } });
    await audit(publicId, 'REWARD_PAYOUT_FAILED', { reason: 'TX_REVERTED' });
    return { status: 'FAILED', txHash: signature, failureReason: 'TX_REVERTED' };
  }
  await prisma.rewardClaim.update({ where: { id: claimId }, data: { status: 'CONFIRMING' } });
  return unknownState(claimId, publicId, signature);
}

async function settleEvm(claimId: string, publicId: string, wallet: ethers.Wallet, hash: string): Promise<ExecuteOutcome> {
  await prisma.rewardClaim.updateMany({
    where: { id: claimId, status: 'PROCESSING', txHash: null },
    data: { status: 'SUBMITTED', txHash: hash, submittedAt: new Date() },
  });
  await audit(publicId, 'REWARD_PAYOUT_SUBMITTED', { txHash: hash });
  const res = await confirmEvm(wallet, hash);
  if (res === 'CONFIRMED') {
    await prisma.rewardClaim.update({ where: { id: claimId }, data: { status: 'PAID', confirmedAt: new Date() } });
    await audit(publicId, 'REWARD_PAYOUT_CONFIRMED', { txHash: hash });
    return { status: 'PAID', txHash: hash, failureReason: null };
  }
  if (res === 'FAILED') {
    await prisma.rewardClaim.update({ where: { id: claimId }, data: { status: 'FAILED', failureReason: 'TX_REVERTED' } });
    await audit(publicId, 'REWARD_PAYOUT_FAILED', { reason: 'TX_REVERTED' });
    return { status: 'FAILED', txHash: hash, failureReason: 'TX_REVERTED' };
  }
  await prisma.rewardClaim.update({ where: { id: claimId }, data: { status: 'CONFIRMING' } });
  return unknownState(claimId, publicId, hash);
}

/**
 * Reconcile an unresolved claim: check the real chain state.
 * - txHash confirmed → PAID. Reverted → FAILED/TX_REVERTED.
 * - txHash not found → PENDING_PAYOUT (amounts kept, safe manual retry).
 * - No txHash → 409 (nothing to reconcile; use retry if pre-broadcast).
 */
export async function reconcileRewardPayout(claimId: string): Promise<ExecuteOutcome> {
  const claim = await prisma.rewardClaim.findUnique({ where: { id: claimId } });
  if (!claim) throw new AppError(404, 'CLAIM_NOT_FOUND', 'Klaim tidak ditemukan.');
  if (claim.status === 'PAID') return { status: 'PAID', txHash: claim.txHash, failureReason: null };
  if (!claim.txHash) throw new AppError(409, 'NOTHING_TO_RECONCILE', 'Belum ada transaksi.');
  const pre = checkLivePrereqs(claim.network);
  if (claim.network === 'SOLANA') {
    const conn = new Connection(pre.rpcUrl, { commitment: 'confirmed' });
    const { value } = await conn.getSignatureStatuses([claim.txHash], { searchTransactionHistory: true });
    const st = value[0];
    if (st?.confirmationStatus === 'confirmed' || st?.confirmationStatus === 'finalized') {
      await prisma.rewardClaim.update({ where: { id: claim.id }, data: { status: 'PAID', confirmedAt: new Date() } });
      await audit(claim.publicId, 'REWARD_PAYOUT_CONFIRMED', { txHash: claim.txHash, via: 'reconcile' });
      return { status: 'PAID', txHash: claim.txHash, failureReason: null };
    }
    if (st?.err) {
      await prisma.rewardClaim.update({ where: { id: claim.id }, data: { status: 'FAILED', failureReason: 'TX_REVERTED' } });
      return { status: 'FAILED', txHash: claim.txHash, failureReason: 'TX_REVERTED' };
    }
    if (st === null) {
      // Nothing on chain: clear the meaningless hash so a later manual retry
      // starts clean (settle guard requires txHash null). Original hash kept
      // in audit log (REWARD_PAYOUT_SUBMITTED) for forensics.
      await prisma.rewardClaim.update({ where: { id: claim.id }, data: { status: 'PENDING_PAYOUT', txHash: null, failureReason: 'RECONCILED_NOT_FOUND' } });
      await audit(claim.publicId, 'REWARD_PAYOUT_RECONCILED', { result: 'not_found_reset_pending' });
      return { status: 'PENDING_PAYOUT', txHash: null, failureReason: 'RECONCILED_NOT_FOUND' };
    }
    return { status: claim.status, txHash: claim.txHash, failureReason: claim.failureReason };
  }
  const wallet = loadEvmSigner(claim.network, pre.treasuryAddress, pre.rpcUrl);
  const receipt = await wallet.provider!.getTransactionReceipt(claim.txHash);
  const currentBlock = await wallet.provider!.getBlockNumber().catch(() => null);
  if (receipt && receipt.status === 1 && currentBlock !== null && currentBlock >= (receipt.blockNumber ?? 0)) {
    await prisma.rewardClaim.update({ where: { id: claim.id }, data: { status: 'PAID', confirmedAt: new Date() } });
    await audit(claim.publicId, 'REWARD_PAYOUT_CONFIRMED', { txHash: claim.txHash, via: 'reconcile' });
    return { status: 'PAID', txHash: claim.txHash, failureReason: null };
  }
  if (receipt && receipt.status === 0) {
    await prisma.rewardClaim.update({ where: { id: claim.id }, data: { status: 'FAILED', failureReason: 'TX_REVERTED' } });
    return { status: 'FAILED', txHash: claim.txHash, failureReason: 'TX_REVERTED' };
  }
  if (receipt === null) {
    // Same as Solana above: clear meaningless hash for a clean retry.
    await prisma.rewardClaim.update({ where: { id: claim.id }, data: { status: 'PENDING_PAYOUT', txHash: null, failureReason: 'RECONCILED_NOT_FOUND' } });
    await audit(claim.publicId, 'REWARD_PAYOUT_RECONCILED', { result: 'not_found_reset_pending' });
    return { status: 'PENDING_PAYOUT', txHash: null, failureReason: 'RECONCILED_NOT_FOUND' };
  }
  return { status: claim.status, txHash: claim.txHash, failureReason: claim.failureReason };
}
