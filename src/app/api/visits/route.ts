import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ok } from '@/lib/response';
import { rateLimit } from '@/lib/rateLimit';
import { readJsonBounded } from '@/lib/apiGuard';

export const dynamic = 'force-dynamic';

/**
 * POST /api/visits — privacy-preserving page-view beacon.
 *
 * Called fire-and-forget by middleware for public page navigations.
 * Stores path + UTC day only — never IP, user-agent, or fingerprint.
 * Only allowlisted page paths are counted (no /api, /_next, /admin).
 */
const schema = z.object({
  path: z.string().min(1).max(120),
});

const ALLOWED = [/^\/$/, /^\/topup$/, /^\/sell$/, /^\/order\/[A-Za-z0-9_-]{1,100}$/];

function normalizePath(raw: string): string | null {
  const noQuery = raw.split('?')[0].split('#')[0];
  const trimmed = noQuery.length > 1 ? noQuery.replace(/\/+$/, '') : noQuery;
  if (!ALLOWED.some((re) => re.test(trimmed))) return null;
  return trimmed;
}

export async function POST(req: NextRequest) {
  try {
    // Cheap abuse throttle. Middleware forwards the viewer IP in x-visit-ip;
    // direct callers fall into the shared 'unknown' bucket (also throttled).
    const fwd = req.headers.get('x-visit-ip')?.trim();
    const ip = fwd && /^[0-9a-fA-F.:]{3,45}$/.test(fwd)
      ? fwd
      : (req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown');
    if (!rateLimit('visits', ip, 300, 60_000, { flood: false })) {
      return ok({});
    }

    const body = schema.parse(await readJsonBounded(req).catch(() => ({})));
    const path = normalizePath(body.path);
    if (!path) return ok({});

    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);

    await prisma.pageVisit.upsert({
      where: { path_day: { path, day } },
      create: { path, day, count: 1 },
      update: { count: { increment: 1 } },
    });
    return ok({});
  } catch {
    // Analytics must never surface errors.
    return ok({});
  }
}
