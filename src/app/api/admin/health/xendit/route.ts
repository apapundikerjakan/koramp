import { NextRequest } from 'next/server';
import { xenditHealthCheck } from '@/lib/xendit';
import { ok, handleError } from '@/lib/response';
import { requireAdmin } from '@/lib/adminAuth';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/health/xendit
 *
 * Admin-only diagnostic for Xendit connectivity + config sanity.
 * - Does not expose XENDIT_API_KEY / XENDIT_WEBHOOK_TOKEN.
 * - No money movement.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const ip = getClientIp(req);
    if (!(await rateLimit('admin-health-xendit', ip, RATE_LIMITS.admin.max, RATE_LIMITS.admin.windowMs))) {
      return ok({ ok: false, error: 'rate_limited' }, 429);
    }

    let reachable = false;
    let httpStatus: number | null = null;
    let errorCategory: string | null = null;
    try {
      const r = await xenditHealthCheck();
      reachable = r.ok;
      httpStatus = r.httpStatus;
      if (!r.ok) errorCategory = 'UNREACHABLE';
    } catch {
      errorCategory = 'UNTANGIBLE';
    }

    return ok({ ok: reachable ? 'healthy' : 'unhealthy', checks: { reachable, httpStatus, errorCategory, provider: 'xendit' } });
  } catch (err) {
    return handleError(err);
  }
}
