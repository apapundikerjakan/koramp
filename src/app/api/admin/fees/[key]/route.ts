/**
 * PUT /api/admin/fees/:key
 * Upsert a FeeConfig row. key format: "SOL_TOP_UP", "ETH_SELL", etc.
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/adminAuth';
import { prisma } from '@/lib/prisma';
import { ok, handleError } from '@/lib/response';
import { AppError } from '@/lib/errors';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const VALID_ASSETS = ['SOL', 'ETH', 'BNB'] as const;
const VALID_TYPES  = ['TOP_UP', 'SELL'] as const;

const schema = z.object({
  serviceFeeRate: z.string().regex(/^\d+(\.\d+)?$/, 'Must be a decimal number'),
  networkFeeRate: z.string().regex(/^\d+(\.\d+)?$/, 'Must be a decimal number'),
  taxRate:        z.string().regex(/^\d+(\.\d+)?$/, 'Must be a decimal number').optional().default('0.001'),
  minOrderIdr:    z.string().regex(/^\d+(\.\d+)?$/, 'Must be a number'),
  maxOrderIdr:    z.string().regex(/^\d+(\.\d+)?$/, 'Must be a number'),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: { key: string } },
) {
  try {
    const admin = await requireAdmin(req);

    // Parse "SOL_TOP_UP" → asset="SOL", type="TOP_UP"
    // key may also be "ETH_SELL" or "BNB_TOP_UP"
    const parts = params.key.split('_');
    // type can be TOP_UP (two parts) or SELL (one part), asset is always first
    const asset = parts[0] as typeof VALID_ASSETS[number];
    const type  = parts.slice(1).join('_') as typeof VALID_TYPES[number];

    if (!VALID_ASSETS.includes(asset)) {
      throw new AppError(400, 'INVALID_KEY', `Unknown asset: ${asset}`);
    }
    if (!VALID_TYPES.includes(type)) {
      throw new AppError(400, 'INVALID_KEY', `Unknown type: ${type}`);
    }

    const { readJsonBounded } = await import('@/lib/apiGuard');
    const body = schema.parse(await readJsonBounded(req));

    // Financial bounds (prevent absurd/malicious fee config even by admin mistake).
    const rate = parseFloat(body.serviceFeeRate);
    if (!(rate >= 0 && rate <= 0.1)) {
      throw new AppError(400, 'INVALID_FEE', 'serviceFeeRate harus 0–0.1 (max 10%)');
    }
    const tax = parseFloat(body.taxRate);
    if (!(tax >= 0 && tax <= 0.1)) {
      throw new AppError(400, 'INVALID_FEE', 'taxRate harus 0–0.1 (max 10%)');
    }
    const net = parseFloat(body.networkFeeRate);
    if (!(net >= 0 && net <= 0.1)) {
      throw new AppError(400, 'INVALID_FEE', 'networkFeeRate harus 0–0.1 (max 10%)');
    }
    if (rate + tax + net >= 1) {
      throw new AppError(400, 'INVALID_FEE', 'Total serviceFeeRate + taxRate + networkFeeRate tidak valid');
    }
    for (const k of ['minOrderIdr', 'maxOrderIdr'] as const) {
      const v = parseFloat(body[k]);
      if (!(v >= 0 && v <= 1_000_000_000)) {
        throw new AppError(400, 'INVALID_FEE', `${k} harus 0–1.000.000.000`);
      }
    }
    if (parseFloat(body.minOrderIdr) > parseFloat(body.maxOrderIdr)) {
      throw new AppError(400, 'INVALID_FEE', 'minOrderIdr tidak boleh > maxOrderIdr');
    }

    const feeConfig = await prisma.feeConfig.upsert({
      where: { assetSymbol_type: { assetSymbol: asset, type } },
      create: {
        assetSymbol:    asset,
        type,
        serviceFeeRate: body.serviceFeeRate,
        networkFeeRate: body.networkFeeRate,
        taxRate:        body.taxRate,
        minOrderIdr:    body.minOrderIdr,
        maxOrderIdr:    body.maxOrderIdr,
        isActive: true,
      },
      update: {
        serviceFeeRate: body.serviceFeeRate,
        networkFeeRate: body.networkFeeRate,
        taxRate:        body.taxRate,
        minOrderIdr:    body.minOrderIdr,
        maxOrderIdr:    body.maxOrderIdr,
      },
    });

    await audit({
      action: 'FEE_CONFIG_UPDATED',
      entity: 'FeeConfig',
      entityId: feeConfig.id,
      actor: `admin:${admin.adminId}`,
      metadata: { key: params.key, ...body },
    });

    return ok({
      saved: true,
      key: params.key,
      serviceFeeRate: feeConfig.serviceFeeRate.toString(),
      networkFeeRate: feeConfig.networkFeeRate.toString(),
      taxRate:        feeConfig.taxRate.toString(),
      minOrderIdr:    feeConfig.minOrderIdr.toString(),
      maxOrderIdr:    feeConfig.maxOrderIdr.toString(),
    });
  } catch (err) { return handleError(err); }
}
