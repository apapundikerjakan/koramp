/**
 * GET /api/admin/wallets/balance
 *
 * Fetches current on-chain balances of all three platform hot wallets
 * (SOL, ETH on Base, BNB on BSC) and returns them alongside their
 * IDR equivalent using live market prices.
 *
 * Admin-only. Called by the admin dashboard "Saldo Platform" panel.
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/adminAuth';
import { getBlockchainProvider } from '@/lib/blockchain';
import { getLivePrice } from '@/lib/marketPrice';
import { prisma } from '@/lib/prisma';
import { ok, handleError } from '@/lib/response';
import Decimal from 'decimal.js';

export const dynamic = 'force-dynamic';

interface WalletBalance {
  asset: string;
  network: string;
  address: string;
  balance: string;           // raw on-chain amount (e.g. "12.5")
  balanceIdr: string;        // IDR equivalent
  pricePerUnit: string;      // current market price per 1 unit
  status: 'ok' | 'error' | 'unconfigured';
  error?: string;
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const networks = [
      { asset: 'SOL' as const, network: 'SOLANA' as const, label: 'SOL',  networkLabel: 'Solana'         },
      { asset: 'ETH' as const, network: 'BASE'   as const, label: 'ETH',  networkLabel: 'Base Network'   },
      { asset: 'BNB' as const, network: 'BSC'    as const, label: 'BNB',  networkLabel: 'BNB Smart Chain' },
    ];

    const results = await Promise.all(
      networks.map(async ({ asset, network, label, networkLabel }): Promise<WalletBalance> => {
        try {
          const bc = getBlockchainProvider(network);
          const address = bc.getDepositAddress('admin-check');

          if (address.includes('NOT_CONFIGURED') || address.includes('INVALID')) {
            return {
              asset: label,
              network: networkLabel,
              address: '',
              balance: '0',
              balanceIdr: '0',
              pricePerUnit: '0',
              status: 'unconfigured',
              error: `${asset} platform wallet not configured`,
            };
          }

          const [balance, price] = await Promise.all([
            // Timeout 8s — don't hang if RPC is slow/unavailable
            Promise.race([
              bc.getBalance(address),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('RPC timeout after 8s')), 8000),
              ),
            ]),
            getLivePrice(asset, prisma),
          ]);

          const balanceNum = new Decimal(balance);
          const balanceIdr = balanceNum.mul(price).toDecimalPlaces(0, Decimal.ROUND_FLOOR).toFixed(0);

          return {
            asset: label,
            network: networkLabel,
            address,
            balance,
            balanceIdr,
            pricePerUnit: price.toFixed(2),
            status: 'ok',
          };
        } catch (err) {
          return {
            asset: networks.find(n => n.network === network)?.label ?? network,
            network: networkLabel,
            address: '',
            balance: '0',
            balanceIdr: '0',
            pricePerUnit: '0',
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );

    // Total IDR equivalent across all wallets (Decimal, no float).
    const totalIdr = results
      .reduce((sum, w) => sum.plus(new Decimal(w.balanceIdr || '0')), new Decimal(0))
      .toDecimalPlaces(0, Decimal.ROUND_FLOOR)
      .toFixed(0);

    return ok({ wallets: results, totalIdr });
  } catch (err) {
    return handleError(err);
  }
}
