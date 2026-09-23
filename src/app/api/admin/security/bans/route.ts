import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/adminAuth';
import { prisma } from '@/lib/prisma';
import { ok, handleError } from '@/lib/response';
import { dropBanCache, formatBanDuration, formatRemaining, makePublicId } from '@/lib/security';

export const dynamic = 'force-dynamic';

const ipSchema = z.string().min(3).max(45).regex(/^[0-9a-fA-F.:]+$/, 'Invalid IP format');

function banView(b: {
  ip: string; publicId: string; reason: string; level: number; violationCount: number;
  requestCount: number; durationMs: number; expiresAt: Date | null; permanent: boolean;
  needsReview: boolean; createdAt: Date; updatedAt: Date;
}) {
  const now = Date.now();
  const active = b.permanent || (b.expiresAt ? b.expiresAt.getTime() > now : false);
  const remainingSec = b.permanent || !b.expiresAt ? null : Math.max(0, Math.ceil((b.expiresAt.getTime() - now) / 1000));
  return {
    ip: b.ip,
    restrictionId: b.publicId,
    reason: b.reason,
    level: b.level,
    violationCount: b.violationCount,
    requestCount: b.requestCount,
    duration: b.permanent ? 'permanent (manual)' : formatBanDuration(Math.round(b.durationMs / 3600000)),
    durationMs: b.durationMs,
    startedAt: b.createdAt,
    expiresAt: b.expiresAt,
    remaining: remainingSec === null ? null : formatRemaining(remainingSec),
    retryAfter: remainingSec,
    needsReview: b.needsReview,
    permanent: b.permanent,
    active,
    updatedAt: b.updatedAt,
  };
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const bans = await prisma.ipBan.findMany({ orderBy: { updatedAt: 'desc' }, take: 100 });
    return ok({ bans: bans.map(banView) });
  } catch (err) { return handleError(err); }
}

const banSchema = z.object({
  ip: ipSchema,
  reason: z.string().min(3).max(200),
  // Omitted durationMs → next progressive step (BAN #N = N hours, capped).
  durationMs: z.number().int().min(60_000).max(30 * 24 * 60 * 60 * 1000).optional(),
  permanent: z.boolean().optional().default(false),
});

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);
    const { readJsonBounded } = await import('@/lib/apiGuard');
    const body = banSchema.parse(await readJsonBounded(req));

    const existing = await prisma.ipBan.findUnique({ where: { ip: body.ip } }).catch(() => null);
    if (existing?.permanent && !body.permanent) {
      return NextResponse.json({ error: { code: 'INVALID_STATE', message: 'Permanent ban must be lifted explicitly first' } }, { status: 409 });
    }

    let violationCount = (existing?.violationCount ?? 0) + 1;
    // Omitted durationMs (non-permanent) → next progressive step through the
    // same engine as automatic bans (cycle counting, cap, decay).
    if (!body.durationMs && !body.permanent) {
      const { imposeBan } = await import('@/lib/security');
      const r = await imposeBan({ ip: body.ip, reason: `Manual progressive ban by admin: ${body.reason}` });
      dropBanCache(body.ip);
      await prisma.auditLog.create({
        data: { action: 'IP_BANNED', entity: 'IpBan', actor: `admin:${admin.adminId}`, metadata: JSON.stringify({ ip: body.ip, violationCount: r.violationCount }) },
      });
      const ban = await prisma.ipBan.findUnique({ where: { ip: body.ip } });
      return ok({ banned: true, ban: ban ? banView(ban) : null });
    }
    const durationMs = body.durationMs as number;

    const ban = await prisma.ipBan.upsert({
      where: { ip: body.ip },
      create: {
        ip: body.ip,
        publicId: existing?.publicId ?? makePublicId(),
        reason: `Manual ban by admin: ${body.reason}`,
        level: 99,
        violationCount,
        requestCount: 0,
        durationMs,
        expiresAt: body.permanent ? null : new Date(Date.now() + durationMs),
        permanent: body.permanent,
        needsReview: false,
        eventRef: `admin:${admin.adminId}`,
      },
      update: {
        reason: `Manual ban by admin: ${body.reason}`,
        level: 99,
        violationCount,
        requestCount: 0,
        durationMs,
        expiresAt: body.permanent ? null : new Date(Date.now() + durationMs),
        permanent: body.permanent,
        needsReview: false,
        eventRef: `admin:${admin.adminId}`,
      },
    });
    dropBanCache(body.ip);
    await prisma.auditLog.create({
      data: { action: body.permanent ? 'IP_BANNED_PERMANENT' : 'IP_BANNED', entity: 'IpBan', entityId: ban.id, actor: `admin:${admin.adminId}`, metadata: JSON.stringify({ ip: body.ip }) },
    });
    return ok({ banned: true, ban: banView(ban) });
  } catch (err) { return handleError(err); }
}

const patchSchema = z.object({
  ip: ipSchema,
  // extend: add ms to expiry | reduce: set violation cycle lower | false-positive: clear + unban
  action: z.enum(['extend', 'reduce', 'false-positive']),
  durationMs: z.number().int().min(60_000).max(30 * 24 * 60 * 60 * 1000).optional(),
  violationCount: z.number().int().min(0).max(1000).optional(),
});

export async function PATCH(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);
    const { readJsonBounded } = await import('@/lib/apiGuard');
    const body = patchSchema.parse(await readJsonBounded(req));
    const existing = await prisma.ipBan.findUnique({ where: { ip: body.ip } });
    if (!existing) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Ban not found' } }, { status: 404 });
    }

    if (body.action === 'false-positive') {
      // Unban but PRESERVE forensics: keep security events, only lift the ban.
      // Use explicit purge flow for data deletion (dual-confirm outside this API).
      await prisma.ipBan.delete({ where: { ip: body.ip } });
      dropBanCache(body.ip);
      await prisma.auditLog.create({
        data: { action: 'IP_FALSE_POSITIVE', entity: 'IpBan', entityId: existing.id, actor: `admin:${admin.adminId}`, metadata: JSON.stringify({ ip: body.ip }) },
      });
      return ok({ cleared: true, ip: body.ip });
    }

    if (body.action === 'extend') {
      // Cap cumulative extension: ban must never become de-facto infinite
      // via repeat-extend. Max total duration capped by MAX_AUTOMATIC_BAN_HOURS
      // unless converted to permanent (explicit).
      const { SEC } = await import('@/lib/security');
      const base = existing.expiresAt && existing.expiresAt.getTime() > Date.now() ? existing.expiresAt.getTime() : Date.now();
      const proposed = new Date(base + (body.durationMs ?? 3600000));
      const maxTotalMs = SEC.maxAutoHours * 3600 * 1000;
      const totalFromStart = proposed.getTime() - existing.createdAt.getTime();
      if (totalFromStart > maxTotalMs && !existing.permanent) {
        return NextResponse.json({ error: { code: 'BAN_CAP_EXCEEDED', message: `Total ban melebihi batas ${SEC.maxAutoHours} jam. Gunakan permanent eksplisit` } }, { status: 400 });
      }
      const expiresAt = proposed;
      const ban = await prisma.ipBan.update({
        where: { ip: body.ip },
        data: { expiresAt, permanent: false, durationMs: expiresAt.getTime() - existing.createdAt.getTime(), eventRef: `admin:${admin.adminId}` },
      });
      dropBanCache(body.ip);
      return ok({ extended: true, ban: banView(ban) });
    }

    // reduce: lower the cycle count (decay takes it from there).
    const ban = await prisma.ipBan.update({
      where: { ip: body.ip },
      data: { violationCount: body.violationCount ?? 0, needsReview: false, eventRef: `admin:${admin.adminId}` },
    });
    dropBanCache(body.ip);
    await prisma.auditLog.create({
      data: { action: 'IP_LEVEL_REDUCED', entity: 'IpBan', entityId: ban.id, actor: `admin:${admin.adminId}`, metadata: JSON.stringify({ ip: body.ip }) },
    });
    return ok({ reduced: true, ban: banView(ban) });
  } catch (err) { return handleError(err); }
}

export async function DELETE(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);
    const ip = new URL(req.url).searchParams.get('ip') ?? '';
    ipSchema.parse(ip);
    await prisma.ipBan.updateMany({ where: { ip }, data: { permanent: false, expiresAt: new Date() } });
    dropBanCache(ip);
    await prisma.auditLog.create({
      data: { action: 'IP_UNBANNED', entity: 'IpBan', actor: `admin:${admin.adminId}`, metadata: JSON.stringify({ ip }) },
    });
    return ok({ unbanned: true, ip });
  } catch (err) { return handleError(err); }
}
