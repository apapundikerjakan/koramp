import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { transfiSimulateOrderStatus, isTransfiStatus } from '@/lib/transfi';
import { prisma } from '@/lib/prisma';
import { ok, handleError } from '@/lib/response';
import { rateLimit, getClientIp } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

const schema = z.object({
  orderPublicId: z.string().min(1).max(100),
  status: z.string().min(1).max(40),
});

// Dev/sandbox only — drive a TransFi order to a target status (fires webhooks).
export async function POST(req: NextRequest) {
  if (process.env.TRANSFI_MODE === 'production' || process.env.NODE_ENV === 'production') {
    return ok({ error: 'Not available in production' }, 404);
  }
  try {
    const ip = getClientIp(req);
    {
      const { banGate } = await import('@/lib/security');
      const rej = await banGate(ip);
      if (rej) return NextResponse.json(rej.body, { status: rej.status, headers: { 'Retry-After': String(rej.retryAfter) } });
    }
    if (!(await rateLimit('payments-simulate', ip, 10, 60_000))) {
      return NextResponse.json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }, { status: 429 });
    }
    const { readJsonBounded } = await import('@/lib/apiGuard');
    const body = schema.parse(await readJsonBounded(req));
    if (!isTransfiStatus(body.status)) {
      return NextResponse.json({ error: { code: 'INVALID_STATUS', message: 'Status tidak dikenal' } }, { status: 400 });
    }
    const order = await prisma.topUpOrder.findUnique({
      where: { publicId: body.orderPublicId },
      include: { payment: { select: { providerOrderId: true } } },
    });
    const providerOrderId = order?.payment?.providerOrderId;
    if (!order || !providerOrderId) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Order/provider tidak ditemukan' } }, { status: 404 });
    }
    const result = await transfiSimulateOrderStatus(providerOrderId, body.status);
    return ok({ result });
  } catch (err) { return handleError(err); }
}
