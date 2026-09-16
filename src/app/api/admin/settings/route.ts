import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { prisma } from '@/lib/prisma';
import { ok, handleError } from '@/lib/response';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    return ok({ settings: await prisma.systemSetting.findMany() });
  } catch (err) { return handleError(err); }
}
