import { NextRequest, NextResponse } from 'next/server';
import { kipayGetQrImage } from '@/lib/kipay';
import { prisma } from '@/lib/prisma';
import { rateLimit, getClientIp } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

// Proxy QRIS image from KiPay — API key stays server-side, browser gets PNG only
export async function GET(req: NextRequest, { params }: { params: { trxId: string } }) {
  try {
    const ip = getClientIp(req);
    // Ban gate: rejected before any expensive work (blockchain RPC, KiPay, DB writes).
    {
      const { banGate } = await import('@/lib/security');
      const rej = await banGate(ip);
      if (rej) return NextResponse.json(rej.body, { status: rej.status, headers: { 'Retry-After': String(rej.retryAfter) } });
    }
    if (!rateLimit('qr-proxy', ip, 30, 60_000)) {
      return NextResponse.json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }, { status: 429 });
    }

    if (!params.trxId || params.trxId.length > 100) {
      return NextResponse.json({ error: { code: 'INVALID_INPUT', message: 'Invalid trxId' } }, { status: 400 });
    }

    // Verify trx_id belongs to a known order
    const payment = await prisma.payment.findUnique({ where: { kipayTrxId: params.trxId } });
    if (!payment) {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Transaksi tidak ditemukan' } }, { status: 404 });
    }

    const kipayRes = await kipayGetQrImage(params.trxId);
    if (!kipayRes.ok) {
      return NextResponse.json({ error: { code: 'QR_FETCH_FAILED', message: 'Gagal mengambil QR' } }, { status: 502 });
    }

    const imageBuffer = await kipayRes.arrayBuffer();
    return new NextResponse(imageBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'private, max-age=60',
      },
    });
  } catch (err) {
    console.error('[QR Proxy]', err);
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Gagal memuat QR' } }, { status: 500 });
  }
}

