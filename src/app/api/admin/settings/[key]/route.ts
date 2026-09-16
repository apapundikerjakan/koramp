import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/adminAuth';
import { prisma } from '@/lib/prisma';
import { ok, handleError } from '@/lib/response';

export const dynamic = 'force-dynamic';

const schema = z.object({
  value: z.string().min(1).max(1000),
});

// Allowlist for manual price keys + general settings prefix.
// Prevents arbitrary key injection while keeping flexibility.
const ALLOWED_EXACT = new Set(['price_sol_idr', 'price_eth_idr', 'price_bnb_idr']);
function isAllowedKey(key: string): boolean {
  if (ALLOWED_EXACT.has(key)) return true;
  if (/^[a-z0-9_]{1,64}$/i.test(key)) return true;
  return false;
}

export async function PUT(req: NextRequest, { params }: { params: { key: string } }) {
  try {
    const admin = await requireAdmin(req);
    if (!isAllowedKey(params.key)) {
      return ok({ error: 'Invalid setting key' }, 400);
    }
    const { value } = schema.parse(await req.json());
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
    await prisma.auditLog.create({ data: { action: 'SETTINGS_CHANGED', entity: 'SystemSetting', actor: `admin:${admin.adminId}`, metadata: JSON.stringify({ key: params.key }) } });
    return ok({ setting });
  } catch (err) { return handleError(err); }
}
