import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import {
  requireAdmin,
  generateAdminKey,
  createSessionToken,
  hashUserAgent,
  getAdminSessionCookie,
  isTotpEnabled,
} from '@/lib/adminAuth';
import { getClientIp } from '@/lib/rateLimit';
import { prisma } from '@/lib/prisma';
import { ok, handleError } from '@/lib/response';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/keys — status Admin Access Key aktif.
 * Tidak pernah mengembalikan plaintext key / verifier (hanya metadata).
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireAdmin(req);
    const admin = await prisma.adminAccessKey.findUnique({
      where: { id: session.adminId },
      select: { keyVersion: true, isActive: true, createdAt: true, lastLoginAt: true },
    });
    if (!admin) {
      return NextResponse.json(
        { error: { code: 'SESSION_INVALID', message: 'Admin session tidak valid' } },
        { status: 401 },
      );
    }
    return ok({
      keyVersion: admin.keyVersion,
      isActive: admin.isActive,
      createdAt: admin.createdAt,
      lastLoginAt: admin.lastLoginAt,
      totpEnabled: isTotpEnabled(),
    });
  } catch (err) {
    return handleError(err);
  }
}

/**
 * POST /api/admin/keys — generate Admin Access Key baru (rotasi).
 * - Key lama langsung dinonaktifkan (semua session perangkat lain mati).
 * - Session saat ini di-reissue ke keyVersion baru agar admin tetap login.
 * - Plaintext key dikembalikan SEKALI — simpan segera, tidak bisa dilihat lagi.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireAdmin(req);

    const { key, verifier } = generateAdminKey();

    await prisma.adminAccessKey.updateMany({
      where: { isActive: true },
      data: { isActive: false },
    });
    const latest = await prisma.adminAccessKey.findFirst({ orderBy: { keyVersion: 'desc' } });
    const nextVersion = (latest?.keyVersion ?? 0) + 1;

    // Session baru untuk admin ini (tetap login setelah rotasi).
    const jti = crypto.randomUUID();
    const uaHash = hashUserAgent(req.headers.get('user-agent') ?? '');
    const record = await prisma.adminAccessKey.create({
      data: {
        id: crypto.randomUUID(),
        keyVerifier: verifier,
        isActive: true,
        keyVersion: nextVersion,
        activeSessionJti: jti,
      },
    });
    const token = await createSessionToken(record.id, nextVersion, jti, uaHash);

    await audit({
      action: 'ADMIN_KEY_ROTATED',
      entity: 'AdminAccessKey',
      entityId: record.id,
      actor: `admin:${session.adminId}`,
      metadata: { keyVersion: nextVersion, via: 'dashboard' },
    });

    const res = NextResponse.json({
      rotated: true,
      keyVersion: nextVersion,
      adminKey: key,
      warning: 'Simpan key ini sekarang — key lama sudah mati dan key ini tidak bisa ditampilkan lagi.',
    });
    res.headers.set('Set-Cookie', getAdminSessionCookie(token));
    return res;
  } catch (err) {
    return handleError(err);
  }
}
