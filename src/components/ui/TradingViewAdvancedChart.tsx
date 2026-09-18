'use client';

/**
 * TradingViewAdvancedModal — on-demand full chart (trigger + modal in one).
 *
 * The Advanced Real-Time Chart EMBED
 * (https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js)
 * is too heavy/interactive for the ~380px sidebar, so it mounts ONLY inside
 * this modal. The trigger is a small ghost button for SummaryPanel.
 *
 * Config notes (keys limited to the documented embed API — no guessing):
 * - theme dark, candles (style "1"), symbol locked (allow_symbol_change false)
 *   so users stay on the asset they are ordering.
 * - The EMBED widget exposes no candle/grid override API (that belongs to the
 *   self-hosted Charting Library) — dark-theme defaults apply (green up /
 *   red down, approximating --success / --error). Deliberately NOT faked with
 *   extra keys.
 * - Attribution line kept (free-widget license requirement) — never hidden.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Expand, X } from 'lucide-react';
import type { AssetSymbol } from '@/lib/assets';
import { TV_SYMBOLS } from '@/lib/tradingView';

const SCRIPT_SRC =
  'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';

function AdvancedChart({ symbol }: { symbol: AssetSymbol }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const tvSymbol = TV_SYMBOLS[symbol];

  useEffect(() => {
    const host = boxRef.current;
    if (!host) return;
    host.innerHTML = '';

    const widget = document.createElement('div');
    widget.className = 'tradingview-widget-container__widget';
    widget.style.height = '100%';

    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.textContent = JSON.stringify({
      autosize: true,
      symbol: tvSymbol,
      interval: '60',
      timezone: 'Asia/Jakarta',
      theme: 'dark',
      style: '1',
      locale: 'id',
      allow_symbol_change: false,
      save_image: false,
      calendar: false,
      support_host: 'https://www.tradingview.com',
    });

    host.append(widget, script);
    return () => {
      host.innerHTML = '';
    };
  }, [tvSymbol]);

  return (
    <div
      ref={boxRef}
      className="tradingview-widget-container w-full h-[60vh] min-h-[420px]"
      role="region"
      aria-label={`Grafik lengkap ${symbol} (USDT)`}
    />
  );
}

export function TradingViewAdvancedModal({ symbol }: { symbol: AssetSymbol }) {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const tvSymbol = TV_SYMBOLS[symbol];

  const close = useCallback(() => setOpen(false), []);

  // Escape-to-close + body scroll lock (same idiom as UnifiedWalletModal).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, close]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#D9B75F] hover:text-[#C7A048] transition-colors"
        aria-haspopup="dialog"
      >
        <Expand className="w-3.5 h-3.5" aria-hidden />
        Lihat grafik lengkap
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Grafik lengkap ${symbol}`}
        >
          <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={close} />
          <div className="relative w-full max-w-4xl bg-surface-1 border border-line rounded-2xl shadow-2xl animate-fade-in overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-line">
              <p className="text-ink-primary font-semibold text-sm">
                {symbol} / USDT <span className="text-ink-muted font-normal">· referensi global</span>
              </p>
              <button
                ref={closeRef}
                type="button"
                onClick={close}
                className="text-ink-muted hover:text-ink-primary p-1.5 rounded-lg hover:bg-white/5 transition-colors"
                aria-label="Tutup grafik"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-3">
              <AdvancedChart symbol={symbol} />
              <p className="px-2 pt-2 pb-1 text-ink-muted text-[11px] leading-relaxed">
                Data TradingView ({tvSymbol}).{' '}
                <a
                  href={`https://www.tradingview.com/symbols/${tvSymbol.replace(':', '-')}/`}
                  rel="noopener nofollow"
                  target="_blank"
                  className="underline underline-offset-2 hover:text-ink-secondary"
                >
                  Buka di TradingView
                </a>
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
