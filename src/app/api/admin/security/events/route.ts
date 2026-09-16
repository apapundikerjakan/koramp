import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { prisma } from '@/lib/prisma';
import { ok, handleError } from '@/lib/response';

export const dynamic = 'force-dynamic';

const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

function threatLevel(counts: Record<string, number>): string {
  if ((counts.CRITICAL ?? 0) > 0) return 'CRITICAL';
  if ((counts.HIGH ?? 0) >= 20) return 'HIGH';
  if ((counts.HIGH ?? 0) > 0 || (counts.MEDIUM ?? 0) >= 20) return 'ELEVATED';
  if ((counts.MEDIUM ?? 0) > 0 || (counts.LOW ?? 0) >= 50) return 'GUARDED';
  return 'LOW';
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const url = new URL(req.url);
    const severity = url.searchParams.get('severity') ?? undefined;
    const type = url.searchParams.get('type') ?? undefined;
    const ip = url.searchParams.get('ip')?.trim() || undefined;
    const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10)));

    const where: Record<string, unknown> = {};
    if (severity && (SEVERITIES as readonly string[]).includes(severity)) where.severity = severity;
    if (type && /^[A-Z_]{3,40}$/.test(type)) where.eventType = type;
    if (ip && ip.length <= 45) where.ip = { contains: ip };

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [events, total, recent] = await Promise.all([
      prisma.securityEvent.findMany({
        where,
        orderBy: { lastSeen: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.securityEvent.count({ where }),
      prisma.securityEvent.findMany({
        where: { lastSeen: { gte: since24h } },
        select: { severity: true, count: true },
        take: 500,
      }),
    ]);

    const counts: Record<string, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
    for (const r of recent) counts[r.severity] = (counts[r.severity] ?? 0) + r.count;

    const activeBans = await prisma.ipBan.count({
      where: { OR: [{ permanent: true }, { expiresAt: { gt: new Date() } }] },
    });

    return ok({
      events: events.map((e) => ({
        id: e.id,
        severity: e.severity,
        eventType: e.eventType,
        ip: e.ip,
        subnet: e.subnet,
        country: e.country,
        endpoint: e.endpoint,
        count: e.count,
        actionTaken: e.actionTaken,
        firstSeen: e.firstSeen,
        lastSeen: e.lastSeen,
      })),
      total,
      page,
      limit,
      summary: { counts24h: counts, threatLevel: threatLevel(counts), activeBans },
    });
  } catch (err) { return handleError(err); }
}
