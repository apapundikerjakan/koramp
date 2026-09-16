import { NextRequest } from 'next/server';
import { getKipayConfig, validateKipayConfig, KIPAY_CUSTOMER_MESSAGE, redactKipayUrl } from '@/lib/kipay';
import { ok } from '@/lib/response';
import { requireAdmin } from '@/lib/adminAuth';
import { rateLimit, getClientIp, RATE_LIMITS } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/health/kipay
 *
 * Admin-only diagnostic for KiPay connectivity + config sanity.
 * - Does not expose KIPAY_API_KEY.
 - Does not construct user-supplied website URLs.
 - Uses the same server-side buildKipayUrl path normalization as the rest of the app.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const ip = getClientIp(req);
    if (!rateLimit('admin-health-kipay', ip, RATE_LIMITS.admin.max, RATE_LIMITS.admin.windowMs)) {
      return ok({ ok: false, error: 'rate_limited' }, 429);
    }

    const configResult = validateKipayConfig();
    const checks: Record<string, unknown> = {
      configuredBaseUrl: configResult.host ? redactKipayUrl(getKipayConfig().baseUrl) : null,
      host: configResult.host ?? null,
      mode: configResult.mode,
      keyConfigured: configResult.keyConfigured,
      baseValid: true,
    };

    let reachable = false;
    let contentType = null;
    let httpStatus = null;
    let upstreamSummary = null;
    let errorCategory = null;

    if (!configResult.keyConfigured) {
      errorCategory = 'CREDENTIAL_MISSING';
    } else {
      try {
        const { buildKipayUrl } = await import('@/lib/kipay');
        const res = await fetch(buildKipayUrl('/transactions'), {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(10_000),
        });
        httpStatus = res.status;
        const ct = res.headers.get('content-type') ?? '';
        contentType = ct.split(';')[0].trim().toLowerCase();
        reachable = res.ok;
        if (!res.ok && ct.trim().toLowerCase() !== 'application/json') {
          upstreamSummary = 'non_json_upstream_response';
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('abort') || message.includes('timeout')) {
          errorCategory = 'UNTANGIBLE';
          upstreamSummary = 'timeout_or_aborted';
        } else {
          errorCategory = 'UNTANGIBLE';
          upstreamSummary = 'network_error';
        }
      }
    }

    checks.reachable = reachable;
    checks.httpStatus = httpStatus;
    checks.contentType = contentType;
    checks.upstreamSummary = upstreamSummary;
    checks.errorCategory = errorCategory;

    const healthy = reachable && contentType === 'application/json' && !errorCategory;
    return ok({ ok: healthy ? 'healthy' : 'unhealthy', checks });
  } catch (err) {
    console.error('[admin/health/kipay]', err);
    return ok({ ok: false, error: 'diagnostic_error' }, 500);
  }
}
