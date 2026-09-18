'use client';

/**
 * SummaryPanel — kolom kanan sticky (desktop) untuk flow topup/sell.
 *
 * Me-reuse FeeBreakdown yang sudah ada (tidak menduplikasi state/rumus):
 * rate, service fee, network fee, tax, total, dan quote countdown semuanya
 * dirender di sini. Di mobile panel yang sama dirender inline (lg:hidden),
 * jadi tidak ada info yang hilang di layar kecil.
 *
 * Tanpa quote (langkah awal): tampilkan kurs live aset + trust list.
 */

import { useEffect, useState } from 'react';
import { Clock, ShieldCheck } from 'lucide-react';
import clsx from 'clsx';
import { FeeBreakdown } from '@/components/ui/FeeBreakdown';
import { TokenIcon, type TokenSymbol } from '@/components/ui/TokenIcon';
import { ShimmerText } from '@/components/ui/motion';
import { formatIDR, formatCrypto } from '@/lib/format';

export type SummaryAsset = TokenSymbol;

const TRUST = [
  'Harga dikunci saat quote dibuat',
  'Pembayaran diverifikasi otomatis',
  'Private key tidak pernah diminta',
];

function Countdown({ secs, refreshing }: { secs: number; refreshing?: boolean }) {
  if (refreshing) {
    return (
      <span className="inline-flex items-center gap-2 text-sm text-[#C7A048]">
        <Clock className="w-4 h-4 animate-spin" aria-hidden />
        Memperbarui harga...
      </span>
    );
  }
  return (
    <span className={clsx('inline-flex items-center gap-2 text-sm', secs < 15 ? 'text-[#E15B4F]' : secs < 30 ? 'text-[#D9A441]' : 'text-ink-secondary')}>
      <Clock className="w-4 h-4" aria-hidden />
      Harga diperbarui dalam <span className="tnum font-semibold">{secs}s</span>
    </span>
  );
}

export function SummaryPanel({
  variant,
  asset,
  networkLabel,
  quote,
  quoteExpiry,
  quoteRefreshing,
}: {
  variant: 'topup' | 'sell';
  asset: SummaryAsset | null;
  networkLabel?: string;
  quote: {
    idrAmount: string | number;
    cryptoAmount: string | number;
    exchangeRate: string | number;
    serviceFee: string | number;
    serviceFeeRate?: string | number | null;
    networkFee: string | number;
    networkFeeRate?: string | number | null;
    tax?: string | number;
    taxRate?: string | number | null;
    totalIdr?: string | number;
    solAtaFeeSol?: string | number;
  } | null;
  quoteExpiry?: number;
  quoteRefreshing?: boolean;
}) {
  const [liveRate, setLiveRate] = useState<string | null>(null);

  useEffect(() => {
    if (quote || !asset) return;
    let stop = false;
    const load = async () => {
      try {
        const res = await fetch('/api/prices', { cache: 'no-store' });
        const data = await res.json();
        if (!stop && res.ok && data.prices?.[asset]) setLiveRate(data.prices[asset]);
      } catch { /* panel tetap tampil tanpa kurs */ }
    };
    load();
    const id = setInterval(load, 60_000);
    return () => { stop = true; clearInterval(id); };
  }, [quote, asset]);

  return (
    <div className="border border-line rounded-2xl bg-surface-1 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-line flex items-center justify-between">
        <p className="font-display font-semibold text-ink-primary">Ringkasan</p>
        {asset && (
          <span className="inline-flex items-center gap-1.5 text-xs text-ink-secondary">
            <TokenIcon symbol={asset} size={16} />
            {asset}{networkLabel ? ` · ${networkLabel}` : ''}
          </span>
        )}
      </div>

      <div className="p-5 space-y-4">
        {quote && asset ? (
          <>
            <div className="flex justify-between text-sm">
              <span className="text-ink-muted">Rate</span>
              <span className="tnum text-ink-primary">1 {asset} = {formatIDR(quote.exchangeRate)}</span>
            </div>

            <FeeBreakdown
              gross={quote.idrAmount}
              serviceFee={quote.serviceFee}
              serviceFeeRate={quote.serviceFeeRate}
              networkFee={quote.networkFee}
              networkFeeRate={quote.networkFeeRate}
              tax={quote.tax ?? 0}
              taxRate={quote.taxRate}
            />

            {variant === 'topup' ? (
              <div className="flex justify-between items-center pt-3 border-t border-line-subtle">
                <span className="text-ink-secondary text-sm font-semibold">Anda terima</span>
                <span className="tnum font-bold text-xl text-[#C7A048]">
                  {formatCrypto(quote.cryptoAmount)} {asset}
                </span>
              </div>
            ) : (
              <div className="space-y-2 pt-3 border-t border-line-subtle">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-ink-muted">Anda kirim</span>
                  <span className="tnum text-ink-primary font-semibold">{formatCrypto(quote.cryptoAmount)} {asset}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-ink-secondary text-sm font-semibold">Anda terima</span>
                  <span className="tnum font-bold text-xl text-[#4CAF6D]">{formatIDR(quote.totalIdr ?? quote.idrAmount)}</span>
                </div>
              </div>
            )}

            {typeof quoteExpiry === 'number' && (
              <div className="pt-1">
                <Countdown secs={quoteExpiry} refreshing={quoteRefreshing} />
              </div>
            )}
          </>
        ) : asset ? (
          <>
            <div className="flex justify-between text-sm">
              <span className="text-ink-muted">Kurs {asset} saat ini</span>
              <span className="tnum text-ink-primary font-semibold">
                {liveRate ? formatIDR(liveRate) : <ShimmerText>Memuat…</ShimmerText>}
              </span>
            </div>
            <p className="text-ink-muted text-xs leading-relaxed">
              Lanjutkan ke langkah nominal untuk mengunci quote — rincian biaya
              akan muncul di sini.
            </p>
          </>
        ) : (
          <p className="text-ink-muted text-sm leading-relaxed">
            Pilih aset dulu — ringkasan kurs dan biaya akan muncul di sini.
          </p>
        )}

        <ul className="pt-3 border-t border-line-subtle space-y-2">
          {TRUST.map((t) => (
            <li key={t} className="flex items-start gap-2 text-xs text-ink-secondary">
              <ShieldCheck className="w-3.5 h-3.5 text-[#2A7A58] flex-shrink-0 mt-0.5" aria-hidden />
              {t}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
