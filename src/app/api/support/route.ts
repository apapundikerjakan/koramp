import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ok, handleError } from '@/lib/response';
import { rateLimit, getClientIp } from '@/lib/rateLimit';
import { guardPublic, readJsonBounded } from '@/lib/apiGuard';
import { EVM_RE, SOL_RE, sameWallet } from '@/lib/support';
import { requireWalletSession } from '@/lib/walletAuth';

export const dynamic = 'force-dynamic';

function err(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

const schema = z.object({
  subject: z.string().min(3).max(200),
  message: z.string().min(10).max(5000),
  walletAddress: z.string().min(10).max(100),
  walletType: z.enum(['EVM', 'SOLANA']),
  orderPublicId: z.string({ required_error: 'Pilih transaksi yang ingin dilaporkan.' }).min(1, 'Pilih transaksi yang ingin dilaporkan.').max(100),
});

/**
 * GET /api/support?wallet=0x... — list my tickets (customer, wallet-first).
 * POST /api/support — submit a support request from the wallet sidebar.
 *
 * A KORAMP order is REQUIRED: every ticket must reference the transaction
 * being reported (no orderless tickets). Ownership and context are resolved
 * server-side from the actual order — client snapshots are never trusted.
 * Customer auth = wallet address match (consistent with existing
 * wallet-first design: address IS identity, same as /api/wallets/[address]/orders).
 */
export async function GET(req: NextRequest) {
  try {
    const g = await guardPublic(req, 'support-read', 30);
    if (g.response) return g.response;
    const wallet = (req.nextUrl.searchParams.get('wallet') ?? '').trim();
    if (!wallet) return err('WALLET_REQUIRED', 'Wallet address diperlukan.', 400);
    if (!EVM_RE.test(wallet) && !SOL_RE.test(wallet)) {
      return err('INVALID_WALLET_ADDRESS', 'Alamat wallet tidak valid.', 400);
    }
    const tickets = await prisma.supportTicket.findMany({
      where: { walletAddress: wallet },
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
      take: 50,
      select: {
        publicId: true, subject: true, status: true, orderPublicId: true,
        orderSide: true, customerUnread: true, lastMessageAt: true, createdAt: true,
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { message: true, senderType: true, createdAt: true } },
      },
    });
    return ok({ tickets });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    if (!(await rateLimit('support-create', ip, 10, 60_000))) {
      return err('RATE_LIMITED', 'Terlalu banyak permintaan. Coba lagi nanti.', 429);
    }
    // Proven ownership FIRST, before parsing untrusted input.
    const session = await requireWalletSession(req, 'SUPPORT');
    const body = await readJsonBounded(req);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return err('INVALID_INPUT', parsed.error.issues[0]?.message ?? 'Input tidak valid.', 400);
    }
    const { subject, message, walletAddress, walletType, orderPublicId } = parsed.data;

    // Proven ownership: ticket is filed as the session wallet.
    if (!sameWallet(walletAddress, session.walletAddress)) {
      return err('WALLET_MISMATCH', 'Wallet sesi tidak cocok dengan wallet pelapor.', 403);
    }
    const reporter = session.walletAddress;

    const validAddr =
      walletType === 'EVM' ? EVM_RE.test(walletAddress) : SOL_RE.test(walletAddress);
    if (!validAddr) {
      return err('WALLET_TYPE_MISMATCH', 'Alamat wallet tidak cocok dengan tipe wallet.', 400);
    }

    const [topup, sell] = await Promise.all([
      prisma.topUpOrder.findUnique({ where: { publicId: orderPublicId } }),
      prisma.sellOrder.findUnique({ where: { publicId: orderPublicId } }),
    ]);
    const order = topup ?? sell;
    if (!order) {
      return err('ORDER_NOT_FOUND', 'Order terkait tidak ditemukan.', 404);
    }
    if (order.walletAddress.toLowerCase() !== reporter.toLowerCase()) {
      return err('ORDER_OWNERSHIP_MISMATCH', 'Order tersebut bukan milik wallet ini.', 403);
    }
    const orderSide = topup ? 'TOP_UP' : 'SELL';
    const orderStatus = order.status;
    const txHash = order.cryptoTxHash ?? undefined;

    const ticket = await prisma.supportTicket.create({
      data: {
        subject,
        message,
        walletAddress: reporter,
        walletType,
        orderPublicId,
        orderSide,
        orderStatus,
        txHash: txHash ?? null,
        lastMessageAt: new Date(),
        adminUnread: 1,
        customerUnread: 0,
        messages: { create: { senderType: 'CUSTOMER', message } },
      },
      include: { messages: { orderBy: { createdAt: 'asc' }, take: 1 } },
    });

    try {
      await prisma.auditLog.create({
        data: { action: 'SUPPORT_TICKET_CREATED', entity: 'SupportTicket', entityId: ticket.publicId, actor: reporter, metadata: JSON.stringify({ orderPublicId }) },
      });
    } catch {}

    return ok(
      { ticket: { publicId: ticket.publicId, status: ticket.status, createdAt: ticket.createdAt } },
      201,
    );
  } catch (err) {
    return handleError(err);
  }
}
