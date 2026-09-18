import { SignJWT, jwtVerify } from 'jose';
import { NextRequest } from 'next/server';
import { prisma } from './prisma';
import crypto from 'crypto';
import { AppError } from './errors';

/**
 * KIPRAMP ADMIN AUTHENTICATION
 *
 * Arsitektur:
 * - Satu kemungkinan admin (tidak ada role hierarchy)
 * - Authentication pakai Admin Access Key (64-char hex) + TOTP 2FA (jika dikonfigurasi)
 * - Key disimpan di DB hanya sebagai SHA-256 verifier (tidak plaintext)
 * - TOTP secret di env ADMIN_TOTP_SECRET (tidak di DB); kode 6 digit, step 30s, window ±1
 * - Setelah login, session pakai JWT di HttpOnly cookie (bukan key)
 * - SATU device aktif: login baru menendang session lama (activeSessionJti),
 *   dan session terikat hash user-agent perangkat login (single-device binding)
 *
 * Flow:
 *   Admin Access Key (64 hex) + kode Authenticator
 *   ↓
 *   POST /api/admin/login
 *   ↓
 *   Verify key (SHA-256) + verify TOTP → buat session JWT (jti baru, tendang lama)
 *   ↓
 *   Set HttpOnly Secure cookie
 *   ↓
 *   Akses /admin dan /api/admin/*
 */

const SESSION_COOKIE_NAME = 'kipramp_admin_session';
export { SESSION_COOKIE_NAME };
// 10-minute idle timeout (P17). Sliding expiration: refreshed on activity via middleware.
export const SESSION_IDLE_TIMEOUT_SEC = 10 * 60;
// Optional absolute max lifetime (e.g. 8h) to force re-auth even if active.
export const SESSION_ABSOLUTE_MAX_SEC = 8 * 60 * 60;
const KEY_HEX_LENGTH = 64; // 64 karakter hex
const KEY_BYTES = 32; // 32 bytes -> 64 hex chars

// ─── Helpers ───────────────────────────────────────────────────────────────────

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret === 'dev-secret-change-in-production') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET must be configured in production');
    }
    console.warn('[adminAuth] WARNING: Using default JWT secret for development');
    return new TextEncoder().encode('dev-secret-change-in-production');
  }
  return new TextEncoder().encode(secret);
}

/** Generate SHA-256 verifier dari plaintext key */
export function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/** Verifikasi format Admin Access Key (64 hex characters) */
export function isValidKeyFormat(key: string): boolean {
  return /^[a-f0-9]{64}$/.test(key);
}

// ─── Key Generation ────────────────────────────────────────────────────────────

/**
 * Generate cryptographically secure Admin Access Key.
 * Output: 64 lowercase hexadecimal characters.
 *
 * Usage:
 *   node -e "import('./src/lib/adminAuth.js').then(m => console.log(m.generateAdminKey().key))"
 *   atau (langsung tersimpan ke database)
 *   npm run admin:setup
 */
export function generateAdminKey(): { key: string; verifier: string } {
  // randomBytes adalah cryptographically secure (bukan Math.random)
  // 32 bytes -> 64 hex chars (bukan 64 bytes yang menghasilkan 128 hex).
  const randomBytesBuffer = crypto.randomBytes(KEY_BYTES);
  const key = randomBytesBuffer.toString('hex'); // 64 karakter hex lowercase

  return {
    key, // ini harus di-share ke admin (sekali saja!)
    verifier: hashKey(key), // ini masuk ke database
  };
}

// ─── Session Token (JWT) ───────────────────────────────────────────────────────

export interface AdminSessionPayload {
  adminId: string;
  keyVersion: number;
  /** Unique session id — only the newest (activeSessionJti) is valid (single-device). */
  jti: string;
  /** SHA-256 hex of the login-time User-Agent — session bound to one device. */
  uaHash: string;
}

/** Hash request User-Agent for device binding (one-way, safe to embed in JWT). */
export function hashUserAgent(ua: string): string {
  return crypto.createHash('sha256').update(ua || '').digest('hex');
}

export async function createSessionToken(
  adminId: string,
  keyVersion: number,
  jti: string,
  uaHash: string,
): Promise<string> {
  // Default 10-minute idle expiry. Only short allowlisted values accepted
  // to prevent accidental long-lived admin sessions (P17).
  const configured = process.env.ADMIN_SESSION_EXPIRES_IN ?? '10m';
  const ALLOWED = new Set(['5m', '10m', '15m']);
  if (!ALLOWED.has(configured)) {
    throw new Error('ADMIN_SESSION_EXPIRES_IN must be one of 5m, 10m, 15m');
  }
  return new SignJWT({ adminId, keyVersion, jti, uaHash })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(configured)
    .sign(getJwtSecret());
}

export async function verifySessionToken(token: string): Promise<AdminSessionPayload> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    const p = payload as unknown as AdminSessionPayload & { iat?: number; exp?: number };
    if (!p.adminId || typeof p.keyVersion !== 'number' || !p.jti || !p.uaHash) {
      throw new AppError(401, 'INVALID_SESSION', 'Session tidak valid atau sudah expired');
    }
    // Enforce absolute max lifetime even with sliding refresh.
    if (typeof p.iat === 'number') {
      const ageSec = Math.floor(Date.now() / 1000) - p.iat;
      if (ageSec > SESSION_ABSOLUTE_MAX_SEC) {
        throw new AppError(401, 'SESSION_EXPIRED', 'Session melebihi batas maksimum, login ulang');
      }
    }
    return { adminId: p.adminId, keyVersion: p.keyVersion, jti: p.jti, uaHash: p.uaHash };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(401, 'INVALID_SESSION', 'Session tidak valid atau sudah expired');
  }
}

/**
 * Re-issue a fresh sliding-expiration token for an active session.
 * Preserves jti + uaHash so single-device binding survives refresh.
 * Called by middleware / session endpoint on every authenticated request
 * so idle timeout slides only while admin is active.
 */
export async function refreshSessionToken(payload: AdminSessionPayload): Promise<string> {
  return createSessionToken(payload.adminId, payload.keyVersion, payload.jti, payload.uaHash);
}

// ─── TOTP 2FA (time-rotating second factor) ────────────────────────────────────
// Standard 30s step (compatible with Google/Microsoft Authenticator), ±1 step
// drift window → usable entry window ≈90s ("1 menit kesempatan" terpenuhi).
// Secret lives in env ADMIN_TOTP_SECRET (base32), never in DB/client.
// TOTP is enforced only when the secret is configured (backward compatible).

export function getTotpSecret(): string | null {
  const s = process.env.ADMIN_TOTP_SECRET?.trim().replace(/\s+/g, '').toUpperCase() || '';
  return s || null;
}

export function isTotpEnabled(): boolean {
  return !!getTotpSecret();
}

export async function verifyTotpCode(code: string): Promise<boolean> {
  const secret = getTotpSecret();
  if (!secret) return true; // not configured → key-only mode (backward compat)
  const clean = code.replace(/\s+/g, '');
  if (!/^\d{6,8}$/.test(clean)) return false;
  try {
    const { authenticator } = await import('otplib');
    authenticator.options = { step: 30, window: 1 };
    return authenticator.check(clean, secret);
  } catch {
    return false;
  }
}

// ─── Authentication API ────────────────────────────────────────────────────────

export async function verifyAdminKey(key: string): Promise<{ id: string; keyVersion: number } | null> {
  // 1. Validasi format dulu
  if (!isValidKeyFormat(key)) {
    return null; // format salah, bukan invalid key — jangan leak info
  }

  // 2. Hash dan cari di database
  const verifier = hashKey(key);
  const admin = await prisma.adminAccessKey.findUnique({
    where: { keyVerifier: verifier },
  });

  if (!admin) {
    return null;
  }

  if (!admin.isActive) {
    return null; // key dinonaktifkan (mis. tergantikan setup baru)
  }

  return { id: admin.id, keyVersion: admin.keyVersion };
}

export async function adminLogin(key: string, userAgent: string, totpCode?: string) {
  const result = await verifyAdminKey(key);

  if (!result) {
    // Generic message — do not reveal whether key or TOTP failed (oracle fix).
    console.warn('[adminAuth] Login attempt failed');
    throw new AppError(401, 'UNAUTHORIZED', 'Kredensial admin tidak valid');
  }

  // Second factor: rotating authenticator code (enforced when configured).
  // Same generic message to avoid key-vs-TOTP oracle.
  if (isTotpEnabled()) {
    const ok = await verifyTotpCode(totpCode ?? '');
    if (!ok) {
      console.warn('[adminAuth] Login attempt failed');
      throw new AppError(401, 'UNAUTHORIZED', 'Kredensial admin tidak valid');
    }
  }

  // Single-device: new jti kicks the previous session immediately.
  const jti = crypto.randomUUID();
  const uaHash = hashUserAgent(userAgent);

  // Update last login + claim the active session atomically-ish (single admin).
  await prisma.adminAccessKey.update({
    where: { id: result.id },
    data: { lastLoginAt: new Date(), activeSessionJti: jti },
  });

  // Buat session token
  const token = await createSessionToken(result.id, result.keyVersion, jti, uaHash);

  return {
    token,
    admin: {
      id: result.id,
      keyVersion: result.keyVersion,
    },
  };
}

export async function requireAdmin(req: NextRequest): Promise<AdminSessionPayload> {
  // Quarantine gate first (memory-cached countdown response, no rule leakage).
  {
    const { getClientIp } = await import('./rateLimit');
    const ip = getClientIp(req);
    const { banGate } = await import('./security');
    const rej = await banGate(ip);
    if (rej) {
      const err = new AppError(403, 'SECURITY_RESTRICTION', 'Access temporarily restricted.');
      (err as unknown as { details: unknown }).details = {
        retryAfter: rej.body.retryAfter,
        restrictionId: rej.body.restrictionId,
        remaining: rej.body.remaining,
      };
      throw err;
    }
  }

  const sessionToken = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionToken) {
    throw new AppError(401, 'UNAUTHORIZED', 'Admin session required');
  }

  const payload = await verifySessionToken(sessionToken);

  // Authenticated admin-API rate limit (120/min per IP — brute-force on
  // stolen sessions + flood containment; login has its own stricter bucket).
  {
    const { rateLimit, getClientIp } = await import('./rateLimit');
    const ip = getClientIp(req);
    if (!rateLimit('admin-api', ip || 'unknown', 120, 60_000)) {
      throw new AppError(429, 'RATE_LIMITED', 'Too many requests. Silakan coba lagi nanti.');
    }
  }

  // Cek apakah admin masih active + keyVersion cocok (rotation invalidates old sessions).
  const admin = await prisma.adminAccessKey.findUnique({
    where: { id: payload.adminId },
  });

  if (!admin || !admin.isActive) {
    throw new AppError(401, 'SESSION_INVALID', 'Admin session tidak valid');
  }

  if (admin.keyVersion !== payload.keyVersion) {
    throw new AppError(401, 'SESSION_INVALID', 'Admin key telah dirotasi, login ulang');
  }

  // Single-device: only the newest session (jti) is valid.
  // A login from device B kicks device A's session immediately.
  if (admin.activeSessionJti && admin.activeSessionJti !== payload.jti) {
    throw new AppError(401, 'SESSION_REVOKED', 'Session digantikan login perangkat lain');
  }

  // Device binding: cookie stolen to another device/browser won't validate.
  // (UA updates occasionally force re-login — accepted tradeoff, documented.)
  const currentUaHash = hashUserAgent(req.headers.get('user-agent') ?? '');
  if (currentUaHash !== payload.uaHash) {
    throw new AppError(401, 'SESSION_INVALID', 'Perangkat/browser berbeda, login ulang');
  }

  return payload;
}

// ─── Logout ────────────────────────────────────────────────────────────────────

export function clearAdminSessionCookie(): string {
  const secure = process.env.NODE_ENV === 'production' ? 'Secure;' : '';
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; ${secure} SameSite=Lax; Max-Age=0`;
}

export function getAdminSessionCookie(token: string): string {
  const secure = process.env.NODE_ENV === 'production' ? 'Secure;' : '';
  // 10-minute idle sliding expiration (P17). Refreshed by middleware on activity.
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; ${secure} SameSite=Lax; Max-Age=${SESSION_IDLE_TIMEOUT_SEC}`;
}

// ─── Session Status Endpoint ───────────────────────────────────────────────────

export async function getAdminSessionStatus(req: NextRequest): Promise<{ authenticated: boolean; admin?: boolean }> {
  try {
    await requireAdmin(req);
    return { authenticated: true, admin: true };
  } catch {
    return { authenticated: false };
  }
}
