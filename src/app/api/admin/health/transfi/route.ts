import { NextRequest } from 'next/server';
import { transfiGetBalance } from '@/lib/transfi';
import { ok, handleError } from '@/lib/response';
import { requireAdmin } from '@/lib/adminAuth';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/health/transfi
 *
 * Admin-only diagnostic for TransFi connectivity + config sanity.
 * - Does not expose TRANSFI_USERNAME/PASSWORD.
 * - Uses server-side base URL allowlist.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const ip = getClientIp(req);
    if (!(await rateLimit('admin-health-transfi', ip, RATE_LIMITS.admin.max, RATE_LIMITS.admin.windowMs))) {
      return ok({ ok: false, error: 'rate_limited' }, 429);
    }

    let reachable = false;
    let httpStatus: number | null = null;
    let errorCategory: string | null = null;
    try {
      const r = await transfiGetBalance();
      reachable = r.ok;
      httpStatus = r.httpStatus;
      if (!r.ok) errorCategory = 'UNREACHABLE';
    } catch {
      errorCategory = 'UNTANGIBLE';
    }

    return ok({ ok: reachable ? 'healthy' : 'unhealthy', checks: { reachable, httpStatus, errorCategory } });
  } catch (err) {
    return handleError(err);
  }
}
