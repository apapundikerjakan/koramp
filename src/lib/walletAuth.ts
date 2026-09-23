/**
 * Wallet ownership proof — challenge/response + short-lived session tokens.
 *
 * Flow: POST /api/wallets/challenge → user signs message → POST
 * /api/wallets/verify → 15-min purpose-bound token in `x-wallet-auth` header.
 *
 * Security properties:
 * - Challenge: random 128-bit nonce, 5-min TTL, single-use, bound to
 *   wallet + ecosystem + purpose. Server rebuilds the message — the client
 *   message is NEVER trusted.
 * - EVM: ethers.verifyMessage, recovered === claimed address.
 * - Solana: ed25519 nacl.detached.verify over UTF-8 message bytes.
 * - Session: HMAC-SHA256 (node:crypto, standard) over base64url payload.
 *   Header-carried (never cookie) → CSRF not applicable.
 * - Store: in-memory Map + WalletChallengeStore interface (swap for Redis
 *   in multi-instance production, same pattern as rate limiter).
 */

import crypto from 'crypto';
import { ethers } from 'ethers';
import nacl from 'tweetnacl';
import { prisma } from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { EVM_RE, SOL_RE } from '@/lib/support';

export const WALLET_PURPOSES = ['REWARD_CLAIM', 'SUPPORT'] as const;
export type WalletPurpose = (typeof WALLET_PURPOSES)[number];

export const WALLET_ECOSYSTEMS = ['EVM', 'SOLANA'] as const;
export type WalletEcosystem = (typeof WALLET_ECOSYSTEMS)[number];

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes

export interface WalletChallenge {
  id: string;
  walletAddress: string; // canonical (EVM lowercase, Solana exact)
  ecosystem: WalletEcosystem;
  purpose: WalletPurpose;
  nonce: string;
  message: string;
  expiresAt: number;
  usedAt: number | null;
}

/**
 * Challenge store. PRODUCTION DEFAULT IS DATABASE (PrismaWalletChallengeStore):
 * Next.js route bundles do not share module-level memory, so a challenge
 * created in /challenge is invisible to /verify when stored in-process.
 * Single-use is enforced atomically via updateMany WHERE usedAt IS NULL
 * (same pattern as Quote consumption).
 */
export interface WalletChallengeStore {
  create(c: WalletChallenge): Promise<void>;
  /** Atomic single-use claim. Returns null when missing, used, or expired. */
  take(id: string, now: number): Promise<WalletChallenge | null>;
  /** Non-consuming read (error classification only). */
  peek(id: string): Promise<WalletChallenge | null>;
}

class MemoryChallengeStore implements WalletChallengeStore {
  private map = new Map<string, WalletChallenge>();
  async create(c: WalletChallenge) { this.map.set(c.id, c); }
  async take(id: string, now: number) {
    const c = this.map.get(id);
    if (!c || c.usedAt !== null || c.expiresAt <= now) return null;
    c.usedAt = now;
    this.map.set(id, c);
    return c;
  }
  async peek(id: string) {
    return this.map.get(id) ?? null;
  }
}

export { MemoryChallengeStore };

class PrismaWalletChallengeStore implements WalletChallengeStore {
  async create(c: WalletChallenge): Promise<void> {
    await prisma.walletChallenge.create({
      data: {
        id: c.id,
        walletAddress: c.walletAddress,
        ecosystem: c.ecosystem,
        purpose: c.purpose,
        nonce: c.nonce,
        message: c.message,
        expiresAt: new Date(c.expiresAt),
      },
    });
    // Opportunistic cleanup of long-expired rows (single indexed delete).
    await prisma.walletChallenge.deleteMany({
      where: { expiresAt: { lt: new Date(Date.now() - 60 * 60 * 1000) } },
    }).catch(() => {});
  }
  async take(id: string, now: number): Promise<WalletChallenge | null> {
    // Atomic single-use claim: only one consumer flips usedAt from NULL.
    const claimed = await prisma.walletChallenge.updateMany({
      where: { id, usedAt: null, expiresAt: { gt: new Date(now) } },
      data: { usedAt: new Date(now) },
    });
    if (claimed.count !== 1) return null;
    const row = await prisma.walletChallenge.findUnique({ where: { id } });
    if (!row) return null;
    return {
      id: row.id,
      walletAddress: row.walletAddress,
      ecosystem: row.ecosystem as WalletEcosystem,
      purpose: row.purpose as WalletPurpose,
      nonce: row.nonce,
      message: row.message,
      expiresAt: row.expiresAt.getTime(),
      usedAt: row.usedAt ? row.usedAt.getTime() : Date.now(),
    };
  }
  async peek(id: string): Promise<WalletChallenge | null> {
    const row = await prisma.walletChallenge.findUnique({ where: { id } });
    if (!row) return null;
    return {
      id: row.id,
      walletAddress: row.walletAddress,
      ecosystem: row.ecosystem as WalletEcosystem,
      purpose: row.purpose as WalletPurpose,
      nonce: row.nonce,
      message: row.message,
      expiresAt: row.expiresAt.getTime(),
      usedAt: row.usedAt ? row.usedAt.getTime() : null,
    };
  }
}

let store: WalletChallengeStore = new PrismaWalletChallengeStore();

/** Swap store backend (tests use MemoryChallengeStore). */
export function setChallengeStore(s: WalletChallengeStore): void {
  store = s;
}

/** Exact server-side message. Human-readable: purpose is explicit, replay across actions impossible. */
export function buildChallengeMessage(args: {
  walletAddress: string;
  ecosystem: WalletEcosystem;
  purpose: WalletPurpose;
  nonce: string;
  expiresAt: number;
}): string {
  return [
    'KORAMP',
    `Action: ${args.purpose}`,
    `Wallet: ${args.walletAddress}`,
    `Ecosystem: ${args.ecosystem}`,
    `Nonce: ${args.nonce}`,
    `Expires: ${new Date(args.expiresAt).toISOString()}`,
  ].join('\n');
}

function assertWalletFormat(walletAddress: string, ecosystem: WalletEcosystem): void {
  const ok = ecosystem === 'EVM' ? EVM_RE.test(walletAddress) : SOL_RE.test(walletAddress);
  if (!ok) throw new AppError(400, 'INVALID_WALLET_ADDRESS', 'Alamat wallet tidak valid.');
}

/**
 * Canonical form: EVM is checksummed-hex (case-insensitive) → lowercase.
 * Solana base58 is CASE-SENSITIVE — never normalize case.
 */
export function canonicalWallet(walletAddress: string, ecosystem: WalletEcosystem): string {
  return ecosystem === 'EVM' ? walletAddress.toLowerCase() : walletAddress;
}

export async function createChallenge(
  walletAddress: string,
  ecosystem: WalletEcosystem,
  purpose: WalletPurpose,
  opts?: { ttlMs?: number },
): Promise<WalletChallenge> {
  if (!(WALLET_PURPOSES as readonly string[]).includes(purpose)) {
    throw new AppError(400, 'INVALID_PURPOSE', 'Tujuan tidak dikenal.');
  }
  if (!(WALLET_ECOSYSTEMS as readonly string[]).includes(ecosystem)) {
    throw new AppError(400, 'INVALID_ECOSYSTEM', 'Ekosistem tidak dikenal.');
  }
  assertWalletFormat(walletAddress, ecosystem);
  const nonce = crypto.randomBytes(16).toString('hex');
  const expiresAt = Date.now() + (opts?.ttlMs ?? CHALLENGE_TTL_MS);
  const c: WalletChallenge = {
    id: crypto.randomUUID(),
    walletAddress: canonicalWallet(walletAddress, ecosystem),
    ecosystem,
    purpose,
    nonce,
    message: '',
    expiresAt,
    usedAt: null,
  };
  c.message = buildChallengeMessage({ walletAddress, ecosystem, purpose, nonce, expiresAt });
  await store.create(c);
  return c;
}

function bs58Decode(input: string): Uint8Array {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const bytes: number[] = [0];
  for (const ch of input) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new Error('bad base58');
    let carry = v;
    for (let i = 0; i < bytes.length; i++) { carry += bytes[i] * 58; bytes[i] = carry & 255; carry >>= 8; }
    while (carry > 0) { bytes.push(carry & 255); carry >>= 8; }
  }
  for (const ch of input) { if (ch !== '1') break; bytes.push(0); }
  return Uint8Array.from(bytes.reverse());
}

/** Verify signature for a challenge. Single-use: take() flips usedAt atomically. */
export async function verifyChallenge(challengeId: string, signature: string): Promise<WalletChallenge> {
  const c = await store.take(challengeId, Date.now());
  if (!c) {
    // Classify for a precise error (peek is read-only, no state change).
    const row = await store.peek(challengeId).catch(() => null);
    if (!row) throw new AppError(401, 'INVALID_CHALLENGE', 'Challenge tidak valid.');
    if (row.usedAt !== null) throw new AppError(401, 'CHALLENGE_REUSED', 'Challenge sudah dipakai.');
    throw new AppError(401, 'CHALLENGE_EXPIRED', 'Challenge kedaluwarsa.');
  }
  if (!signature || signature.length > 500) throw new AppError(401, 'INVALID_SIGNATURE', 'Signature tidak valid.');

  if (c.ecosystem === 'EVM') {
    let recovered: string;
    try {
      recovered = ethers.verifyMessage(c.message, signature);
    } catch {
      throw new AppError(401, 'INVALID_SIGNATURE', 'Signature tidak valid.');
    }
    if (recovered.toLowerCase() !== c.walletAddress) {
      throw new AppError(401, 'INVALID_SIGNATURE', 'Signature bukan milik wallet ini.');
    }
  } else {
    let ok = false;
    try {
      const msgBytes = new TextEncoder().encode(c.message);
      const sigBytes = Uint8Array.from(Buffer.from(signature.replace(/^0x/, ''), 'hex'));
      const pubBytes = bs58Decode(c.walletAddress);
      // Solana wallets sign raw bytes; accept hex or base58 signatures.
      const trySigs: Uint8Array[] = [sigBytes];
      try { trySigs.push(bs58Decode(signature)); } catch { /* hex path already covered */ }
      const unique: Uint8Array[] = [];
      for (const s of trySigs) {
        if (s.length === 64 && !unique.some((u) => Buffer.from(u).equals(Buffer.from(s)))) unique.push(s);
      }
      ok = unique.some((s) => {
        try {
          return nacl.sign.detached.verify(msgBytes, s, pubBytes);
        } catch {
          return false;
        }
      });
    } catch {
      ok = false;
    }
    if (!ok) throw new AppError(401, 'INVALID_SIGNATURE', 'Signature bukan milik wallet ini.');
  }
  return c;
}

// ─── Session tokens (HMAC-SHA256, header-carried) ──────────────────────────

function getSessionSecret(): Buffer {
  const s = process.env.JWT_SECRET ?? '';
  if (!s || s === 'dev-secret-change-in-production') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET must be configured in production');
    }
    return Buffer.from('dev-secret-change-in-production');
  }
  return Buffer.from(s);
}

export interface WalletSession {
  walletAddress: string;
  ecosystem: WalletEcosystem;
  purpose: WalletPurpose;
}

function b64url(data: string | Buffer): string {
  return Buffer.from(data).toString('base64url');
}

/** Issue a purpose-bound session token (default 15 min). */
export function issueWalletSession(s: WalletSession, opts?: { ttlMs?: number }): { token: string; expiresAt: number } {
  const now = Date.now();
  const expiresAt = now + (opts?.ttlMs ?? SESSION_TTL_MS);
  const payload = {
    v: 1,
    aud: 'KORAMP-wallet',
    w: canonicalWallet(s.walletAddress, s.ecosystem),
    eco: s.ecosystem,
    p: s.purpose,
    iat: now,
    exp: expiresAt,
    jti: crypto.randomUUID(),
  };
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', getSessionSecret()).update(body).digest('base64url');
  return { token: `${body}.${sig}`, expiresAt };
}

/** Verify token + purpose binding. Throws 401 on any failure. */
export function verifyWalletSession(token: string, purpose: WalletPurpose): WalletSession {
  const parts = (token ?? '').split('.');
  if (parts.length !== 2) throw new AppError(401, 'WALLET_SESSION_INVALID', 'Sesi wallet tidak valid.');
  const [body, sig] = parts;
  const expect = crypto.createHmac('sha256', getSessionSecret()).update(body).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(sig, 'base64url');
  } catch {
    throw new AppError(401, 'WALLET_SESSION_INVALID', 'Sesi wallet tidak valid.');
  }
  if (actual.length !== expect.length || !crypto.timingSafeEqual(actual, expect)) {
    throw new AppError(401, 'WALLET_SESSION_INVALID', 'Sesi wallet tidak valid.');
  }
  let payload: { v?: number; aud?: string; w?: string; eco?: string; p?: string; exp?: number };
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw new AppError(401, 'WALLET_SESSION_INVALID', 'Sesi wallet tidak valid.');
  }
  if (payload.v !== 1 || payload.aud !== 'KORAMP-wallet' || typeof payload.exp !== 'number' || Date.now() > payload.exp) {
    throw new AppError(401, 'WALLET_SESSION_EXPIRED', 'Sesi wallet kedaluwarsa.');
  }
  if (payload.p !== purpose) {
    throw new AppError(401, 'WALLET_SESSION_WRONG_PURPOSE', 'Sesi tidak berlaku untuk aksi ini.');
  }
  if (!payload.w || (payload.eco !== 'EVM' && payload.eco !== 'SOLANA')) {
    throw new AppError(401, 'WALLET_SESSION_INVALID', 'Sesi wallet tidak valid.');
  }
  return { walletAddress: payload.w, ecosystem: payload.eco, purpose: payload.p as WalletPurpose };
}

/**
 * Server-side gate for sensitive wallet actions. Reads `x-wallet-auth`
 * (`Bearer <token>` or raw). Returns the PROVEN identity — handlers must use
 * session.walletAddress, never a body-claimed address alone.
 */
export async function requireWalletSession(req: Request, purpose: WalletPurpose): Promise<WalletSession> {
  const h = req.headers.get('x-wallet-auth') ?? '';
  const token = h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : h.trim();
  if (!token) throw new AppError(401, 'WALLET_SESSION_REQUIRED', 'Verifikasi wallet diperlukan.');
  return verifyWalletSession(token, purpose);
}
