'use client';

/**
 * RateBoard — "papan kurs" loket: hairline rows, tabular numerals, no cards.
 * Polls /api/prices every 60s. Missing prices render "—", never fake numbers.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { TokenIcon, type TokenSymbol } from '@/components/ui/TokenIcon';
import { ShimmerText } from '@/components/ui/motion';
import { formatIDR } from '@/lib/format';

const ROWS: { symbol: TokenSymbol; name: string; network: string }[] = [
  { symbol: 'SOL', name: 'Solana', network: 'Solana' },
  { symbol: 'ETH', name: 'Ethereum', network: 'Base' },
  { symbol: 'BNB', name: 'BNB', network: 'BSC' },
];

export function RateBoard() {
  const [prices, setPrices] = useState<Record<string, string | null> | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (silent: boolean) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch('/api/prices', { cache: 'no-store' });
      const data = await res.json();
      if (res.ok && data.prices) {
        setPrices(data.prices);
        setUpdatedAt(new Date(data.fetchedAt ?? Date.now()));
      }
    } catch { /* keep last board on failure */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load(false);
    const id = setInterval(() => load(true), 60_000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="border border-line rounded-2xl bg-surface-1 overflow-hidden" role="region" aria-label="Papan kurs">
      <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-line">
        <p className="font-display font-semibold text-ink-primary">Papan kurs</p>
        <span className="inline-flex items-center gap-1.5 text-xs text-ink-secondary">
          <span className="w-1.5 h-1.5 rounded-full bg-[#4CAF6D] animate-pulse" aria-hidden />
          {loading && !prices ? <ShimmerText>Memuat…</ShimmerText> : 'Live'}
        </span>
      </div>

      <div>
        {ROWS.map((r) => (
          <div key={r.symbol} className="rate-row">
            <div className="flex items-center gap-3 min-w-0">
              <TokenIcon symbol={r.symbol} size={28} />
              <div className="min-w-0">
                <p className="text-ink-primary font-semibold text-sm leading-tight">
                  {r.symbol} <span className="text-ink-muted font-normal">/ IDR</span>
                </p>
                <p className="text-ink-muted text-xs">{r.name} · {r.network}</p>
              </div>
            </div>
            <p className="tnum text-ink-primary font-semibold text-base sm:text-lg whitespace-nowrap" aria-live="off">
              {prices?.[r.symbol] ? formatIDR(prices[r.symbol] as string) : <span className="text-ink-muted">—</span>}
            </p>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-t border-line bg-surface-2/60">
        <p className="text-ink-muted text-xs">
          Kurs indikatif per 1 aset{updatedAt ? ` · ${updatedAt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}` : ''}
        </p>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={() => load(true)}
            className="icon-btn !w-8 !h-8"
            aria-label="Muat ulang kurs"
            title="Muat ulang kurs"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden />
          </button>
          <Link href="/topup" className="text-xs font-bold text-[#131916] bg-[#C7A048] hover:bg-[#D9B75F] rounded-lg px-3 py-2 transition-colors">
            Top Up
          </Link>
        </div>
      </div>
    </div>
  );
}
