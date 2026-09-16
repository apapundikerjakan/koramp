/**
 * GET /api/admin/fees
 * Returns global fee config (from SOL_TOP_UP as reference — all assets share same rates).
 * Also returns individual rows for legacy compatibility.
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { prisma } from '@/lib/prisma';
import { ok, handleError } from '@/lib/response';

export const dynamic = 'force-dynamic';

const ASSETS = ['SOL', 'ETH', 'BNB'] as const;
const TYPES = ['TOP_UP', 'SELL'] as const;

const TYPE_LABELS: Record<string, string> = {
  TOP_UP: 'Top Up (Beli)',
  SELL: 'Sell (Jual)',
};

const DEFAULTS = {
  serviceFeeRate: '0.005',
  networkFeeRate: '0.001',
  taxRate: '0.001',
  minOrderIdr: '50000',
  maxOrderIdr: '100000000',
  solAtaFeeIdr: '0',
};

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const rows = await prisma.feeConfig.findMany();
    const indexed = Object.fromEntries(
      rows.map(r => [`${r.assetSymbol}_${r.type}`, r]),
    );

    // Use SOL_TOP_UP as the "global" reference row for the unified form.
    const refRow = indexed['SOL_TOP_UP'];
    const global = {
      serviceFeeRate: refRow?.serviceFeeRate?.toString() ?? DEFAULTS.serviceFeeRate,
      networkFeeRate: refRow?.networkFeeRate?.toString() ?? DEFAULTS.networkFeeRate,
      taxRate:        refRow?.taxRate?.toString()        ?? DEFAULTS.taxRate,
      minOrderIdr:    refRow?.minOrderIdr?.toString()    ?? DEFAULTS.minOrderIdr,
      maxOrderIdr:    refRow?.maxOrderIdr?.toString()    ?? DEFAULTS.maxOrderIdr,
      solAtaFeeIdr:   refRow?.solAtaFeeIdr?.toString()   ?? DEFAULTS.solAtaFeeIdr,
    };

    // Also return individual rows (used by the legacy individual-save path).
    const fees = ASSETS.flatMap(asset =>
      TYPES.map(type => {
        const key = `${asset}_${type}`;
        const row = indexed[key];
        return {
          key,
          label: `${asset} — ${TYPE_LABELS[type]}`,
          serviceFeeRate: row?.serviceFeeRate?.toString() ?? DEFAULTS.serviceFeeRate,
          networkFeeRate: row?.networkFeeRate?.toString() ?? DEFAULTS.networkFeeRate,
          taxRate:        row?.taxRate?.toString()        ?? DEFAULTS.taxRate,
          minOrderIdr:    row?.minOrderIdr?.toString()    ?? DEFAULTS.minOrderIdr,
          maxOrderIdr:    row?.maxOrderIdr?.toString()    ?? DEFAULTS.maxOrderIdr,
          solAtaFeeIdr:   row?.solAtaFeeIdr?.toString()   ?? DEFAULTS.solAtaFeeIdr,
        };
      }),
    );

    return ok({ global, fees });
  } catch (err) { return handleError(err); }
}
