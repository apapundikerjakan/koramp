'use client';

import clsx from 'clsx';

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
 */

function fmtIDR(n: string | number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(Number(n));
}

function fmtPct(rate: string | number | null | undefined): string {
  if (rate == null || rate === '') return '';
  const v = Number(rate);
  if (!Number.isFinite(v)) return '';
  return ` (${new Intl.NumberFormat('id-ID', {
    style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(v)})`;
}

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
}

export function FeeBreakdown(p: FeeBreakdownProps) {
  const num = (v: string | number) => Number(v) || 0;
  const gross = num(p.gross);
  const total = num(p.serviceFee) + num(p.networkFee) + num(p.tax);
  const t = p.size === 'xs' ? 'text-xs' : 'text-sm';
  const totalPct = gross > 0
    ? ` (${new Intl.NumberFormat('id-ID', {
        style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2,
      }).format(total / gross)})`
    : '';

  return (
    <div className={clsx('space-y-1.5', p.className)}>
      <div className={clsx('flex justify-between', t)}>
        <span className="text-gray-500">Biaya layanan{fmtPct(p.serviceFeeRate)}</span>
        <span className="text-red-400">− {fmtIDR(p.serviceFee)}</span>
      </div>
      <div className={clsx('flex justify-between', t)}>
        <span className="text-gray-500">Tax{fmtPct(p.taxRate)}</span>
        <span className="text-red-400">− {fmtIDR(p.tax)}</span>
      </div>
      <div className={clsx('flex justify-between', t)}>
        <span className="text-gray-500">Biaya jaringan{fmtPct(p.networkFeeRate)}</span>
        <span className="text-red-400">− {fmtIDR(p.networkFee)}</span>
      </div>
      <div className={clsx('flex justify-between font-semibold pt-1.5 border-t border-[#1a1a3e]', t)}>
        <span className="text-gray-300">Total potongan{totalPct}</span>
        <span className="text-red-400">− {fmtIDR(total)}</span>
      </div>
    </div>
  );
}
