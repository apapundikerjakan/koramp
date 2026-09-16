/**
 * PUT /api/admin/fees/bulk
 *
 * Update semua 6 FeeConfig rows sekaligus (SOL/ETH/BNB × TOP_UP/SELL)
 * dengan satu set nilai. Memudahkan admin yang ingin fee seragam untuk
 * semua aset dan tipe transaksi.
 *
 * Body:
 *   serviceFeeRate  — % dari gross IDR (e.g. "0.005" = 0.5%)
 *   taxRate         — % dari gross IDR (e.g. "0.001" = 0.1%)
 *   networkFeeRate  — % dari gross IDR (e.g. "0.001" = 0.1%)
 *   minOrderIdr     — minimum order dalam IDR
 *   maxOrderIdr     — maximum order dalam IDR
 *   solAtaFeeIdr    — flat IDR cadangan biaya ATA Solana (hanya berlaku SOL)
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/adminAuth';
import { prisma } from '@/lib/prisma';
import { ok, handleError } from '@/lib/response';
import { AppError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const ASSETS = ['SOL', 'ETH', 'BNB'] as const;
const TYPES  = ['TOP_UP', 'SELL'] as const;

const schema = z.object({
  serviceFeeRate: z.string().regex(/^\d+(\.\d+)?$/),
  taxRate:        z.string().regex(/^\d+(\.\d+)?$/),
  networkFeeRate: z.string().regex(/^\d+(\.\d+)?$/),
  minOrderIdr:    z.string().regex(/^\d+(\.\d+)?$/),
  maxOrderIdr:    z.string().regex(/^\d+(\.\d+)?$/),
  solAtaFeeIdr:   z.string().regex(/^\d+(\.\d+)?$/).default('0'),
});

export async function PUT(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);
    const body  = schema.parse(await req.json());

    // Validate rates
    const service = parseFloat(body.serviceFeeRate);
    const tax     = parseFloat(body.taxRate);
    const net     = parseFloat(body.networkFeeRate);
    const ata     = parseFloat(body.solAtaFeeIdr);

    if (!(service >= 0 && service <= 0.1)) throw new AppError(400, 'INVALID_FEE', 'serviceFeeRate harus 0–0.1');
    if (!(tax >= 0 && tax <= 0.1))         throw new AppError(400, 'INVALID_FEE', 'taxRate harus 0–0.1');
    if (!(net >= 0 && net <= 0.1))         throw new AppError(400, 'INVALID_FEE', 'networkFeeRate harus 0–0.1');
    if (service + tax + net >= 1)          throw new AppError(400, 'INVALID_FEE', 'Total fee rate tidak valid');
    // solAtaFeeIdr stores SOL units (column name kept for backward compat)
    if (ata < 0 || ata > 0.01)             throw new AppError(400, 'INVALID_FEE', 'SOL ATA fee harus 0–0.01 SOL');
    if (parseFloat(body.minOrderIdr) > parseFloat(body.maxOrderIdr)) {
      throw new AppError(400, 'INVALID_FEE', 'minOrderIdr tidak boleh > maxOrderIdr');
    }

    // Upsert all 6 combinations atomically
    await prisma.$transaction(
      ASSETS.flatMap(asset =>
        TYPES.map(type =>
          prisma.feeConfig.upsert({
            where: { assetSymbol_type: { assetSymbol: asset, type } },
            create: {
              assetSymbol:    asset,
              type,
              serviceFeeRate: body.serviceFeeRate,
              networkFeeRate: body.networkFeeRate,
              taxRate:        body.taxRate,
              minOrderIdr:    body.minOrderIdr,
              maxOrderIdr:    body.maxOrderIdr,
              solAtaFeeIdr:   asset === 'SOL' ? body.solAtaFeeIdr : '0',
              isActive: true,
            },
            update: {
              serviceFeeRate: body.serviceFeeRate,
              networkFeeRate: body.networkFeeRate,
              taxRate:        body.taxRate,
              minOrderIdr:    body.minOrderIdr,
              maxOrderIdr:    body.maxOrderIdr,
              // Only update solAtaFeeIdr for SOL rows
              ...(asset === 'SOL' ? { solAtaFeeIdr: body.solAtaFeeIdr } : {}),
            },
          }),
        ),
      ),
    );

    await prisma.auditLog.create({
      data: {
        action: 'FEE_CONFIG_BULK_UPDATED',
        entity: 'FeeConfig',
        actor: `admin:${admin.adminId}`,
        metadata: JSON.stringify(body),
      },
    });

    return ok({ saved: true, updated: ASSETS.length * TYPES.length });
  } catch (err) { return handleError(err); }
}
