import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/adminAuth';
import { prisma } from '@/lib/prisma';
import { ok, handleError } from '@/lib/response';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const schema = z.object({
  value: z.string().min(1).max(1000),
});

// Allowlist for manual price keys + explicitly approved settings.
// Previously a loose regex allowed ANY key — now strictly allowlisted to
// prevent SystemSetting key pollution / future key-confusion.
const ALLOWED_EXACT = new Set([
  'price_sol_idr', 'price_eth_idr', 'price_bnb_idr',
  'maintenance_mode', 'announcement_id', 'support_contact',
]);
function isAllowedKey(key: string): boolean {
  if (ALLOWED_EXACT.has(key)) return true;
  return false;
}

export async function PUT(req: NextRequest, { params }: { params: { key: string } }) {
  try {
    const admin = await requireAdmin(req);
    if (!isAllowedKey(params.key)) {
      return ok({ error: 'Invalid setting key' }, 400);
    }
    const { readJsonBounded } = await import('@/lib/apiGuard');
    const { value } = schema.parse(await readJsonBounded(req));
    // Manual price keys must be positive numbers (financial safety).
    if (params.key.startsWith('price_')) {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0 || n > 10_000_000_000_000) {
        return ok({ error: 'Manual price harus angka positif wajar' }, 400);
      }
    }
    const setting = await prisma.systemSetting.upsert({
      where: { key: params.key },
      create: { key: params.key, value },
      update: { value },
    });
    await audit({ action: 'SETTINGS_CHANGED', entity: 'SystemSetting', actor: `admin:${admin.adminId}`, metadata: { key: params.key } });
    return ok({ setting });
  } catch (err) { return handleError(err); }
}
