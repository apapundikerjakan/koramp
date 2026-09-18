'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { ChevronDown } from 'lucide-react';
import { formatIDR, formatPct } from '@/lib/format';

/**
 * FeeBreakdown — SATU kalkulator transparan untuk semua transaksi.
 *
 * Dipakai di: Top Up (confirm), Sell (bank + confirm), Order tracking.
 * Struktur potongan SELALU sama (top up maupun sell):
 *   1. Biaya layanan — % dari nilai bruto (diatur di dashboard admin)
 *   2. Tax           — % dari nilai bruto (diatur di dashboard admin)
 *   3. Biaya jaringan — flat IDR (biaya gas blockchain)
 * Total ditampilkan sebagai satu angka + % efektif agar jelas dan tidak
 * terlihat berlapis-lapis.
 *
 * Formatting memakai shared lib/format (single source of truth).
 */

export interface FeeBreakdownProps {
  /** Nilai bruto (sebelum potongan) dalam IDR. */
  gross: string | number;
  serviceFee: string | number;
  serviceFeeRate?: string | number | null;
  networkFee: string | number;
  networkFeeRate?: string | number | null;
  tax: string | number;
  taxRate?: string | number | null;
  /** Ukuran teks baris: 'xs' (ringkas) atau 'sm' (default). */
  size?: 'xs' | 'sm';
  className?: string;
  /** Ringkas + expandable (Beautiful UI diff pattern) — default expanded. */
  collapsible?: boolean;
}

function pctSuffix(rate: string | number | null | undefined): string {
  if (rate == null || rate === '') return '';
  const v = Number(rate);
  if (!Number.isFinite(v)) return '';
  return ` (${formatPct(v)})`;
}

export function FeeBreakdown(p: FeeBreakdownProps) {
  const [open, setOpen] = useState(true);
  const num = (v: string | number) => Number(v) || 0;
  const gross = num(p.gross);
  const total = num(p.serviceFee) + num(p.networkFee) + num(p.tax);
  const t = p.size === 'xs' ? 'text-xs' : 'text-sm';
  const totalPct = gross > 0 ? ` (${formatPct(total / gross)})` : '';
  const collapsed = p.collapsible && !open;

  return (
    <div className={clsx('space-y-1.5', p.className)}>
      {p.collapsible && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          <ChevronDown className={clsx('w-3.5 h-3.5 transition-transform', open && 'rotate-180')} aria-hidden />
          Rincian biaya
        </button>
      )}
      {!collapsed && (
        <>
          <div className={clsx('flex justify-between', t)}>
            <span className="text-gray-500">Biaya layanan{pctSuffix(p.serviceFeeRate)}</span>
            <span className="text-red-400">− {formatIDR(p.serviceFee)}</span>
          </div>
          <div className={clsx('flex justify-between', t)}>
            <span className="text-gray-500">Tax{pctSuffix(p.taxRate)}</span>
            <span className="text-red-400">− {formatIDR(p.tax)}</span>
          </div>
          <div className={clsx('flex justify-between', t)}>
            <span className="text-gray-500">Biaya jaringan{pctSuffix(p.networkFeeRate)}</span>
            <span className="text-red-400">− {formatIDR(p.networkFee)}</span>
          </div>
        </>
      )}
      <div className={clsx('flex justify-between font-semibold pt-1.5 border-t border-[#1a1a3e]', t)}>
        <span className="text-gray-300">Total potongan{totalPct}</span>
        <span className="text-red-400">− {formatIDR(total)}</span>
      </div>
    </div>
  );
}
