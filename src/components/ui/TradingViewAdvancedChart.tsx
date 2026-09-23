'use client';

/**
 * TradingViewTerminalChart — full Advanced Real-Time Chart for the trading
 * terminal's left column (topup/sell). Mounted via next/dynamic ssr:false
 * from the pages (client-only; no wallet/SSR graph involved).
 *
 * Uses the official TradingView Advanced Chart EMBED
 * (https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js),
 * which ships live TradingView data — NOT lightweight-charts (empty renderer).
 *
 * Mounting hardening (post-mortem of the broken mini widget in Ringkasan):
 * 1. CSP root cause (verified against the actual loader source): the widget
 *    iframe is served from https://www.tradingview-widget.com (NOT
 *    www.tradingview.com) with an s.tradingview.com CSP fallback — both must
 *    be in frame-src or the iframe is blocked and the box stays empty.
 *    Fixed in next.config.js.
 * 2. Unique container id per instance (useId) — no hardcoded shared id.
 * 3. Explicit dimensions BEFORE inject: the host has a fixed CSS height
 *    (h-64 mobile / viewport-based desktop) and the inner widget div is
 *    pinned to 100% × 100%, so the script never measures a 0-size box.
 * 4. Single-inject guard (injectedRef) + full cleanup (host.innerHTML = '')
 *    so re-renders / StrictMode remounts / symbol switches never stack
 *    duplicate scripts.
 * 5. script.onerror → graceful fallback panel (retry + external link) instead
 *    of a dead grey box when the network blocks TradingView.
 *
 * Theming uses only whitelisted embed keys (verified in the loader source):
 * backgroundColor / gridColor / overrides (candle up = brass, down = error).
 * Attribution link kept below the chart (free-widget license requirement).
 */

import { useEffect, useId, useRef, useState } from 'react';
import { Activity, ExternalLink, RefreshCw } from 'lucide-react';
import { TokenIcon } from '@/components/ui/TokenIcon';
import type { AssetSymbol } from '@/lib/assets';
import { TV_SYMBOLS, TV_DISCLAIMER } from '@/lib/tradingView';

const SCRIPT_SRC =
  'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';

function tvLink(tvSymbol: string): string {
  return `https://www.tradingview.com/symbols/${tvSymbol.replace(':', '-')}/`;
}

function ChartHost({ symbol }: { symbol: AssetSymbol }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rawId = useId().replace(/:/g, '');
  const hostId = `tv-terminal-${rawId}`;
  const injectedRef = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const tvSymbol = TV_SYMBOLS[symbol];

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // Single-inject guard: same symbol already mounted (re-render, no-op).
    if (injectedRef.current === `${tvSymbol}#${attempt}`) return;
    injectedRef.current = `${tvSymbol}#${attempt}`;
    setFailed(false);
    host.innerHTML = '';

    const widget = document.createElement('div');
    widget.className = 'tradingview-widget-container__widget';
    widget.style.width = '100%';
    widget.style.height = '100%';

    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onerror = () => {
      injectedRef.current = null;
      setFailed(true);
    };
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
      backgroundColor: 'rgba(19, 25, 22, 1)', // --bg-surface-1
      gridColor: 'rgba(61, 82, 64, 0.5)', // --border-strong
      overrides: {
        'mainSeriesProperties.candleStyle.upColor': '#C7A048', // --accent brass
        'mainSeriesProperties.candleStyle.downColor': '#E15B4F', // --error
        'mainSeriesProperties.candleStyle.wickUpColor': '#C7A048',
        'mainSeriesProperties.candleStyle.wickDownColor': '#E15B4F',
        'mainSeriesProperties.candleStyle.borderUpColor': '#C7A048',
        'mainSeriesProperties.candleStyle.borderDownColor': '#E15B4F',
      },
      support_host: 'https://www.tradingview.com',
    });

    host.append(widget, script);
    return () => {
      injectedRef.current = null;
      host.innerHTML = '';
    };
  }, [tvSymbol, attempt]);

  if (failed) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center gap-3 px-6 text-center">
        <Activity className="w-8 h-8 text-ink-muted" aria-hidden />
        <p className="text-ink-secondary text-sm font-semibold">Grafik IDR tidak dapat dimuat</p>
        <p className="text-ink-muted text-xs leading-relaxed">
          Koneksi ke TradingView diblokir atau terputus. Order tetap bisa dilanjutkan
          dengan kurs live KORAMP.
        </p>
        <div className="flex items-center gap-2 mt-1">
          <button
            type="button"
            onClick={() => setAttempt((a) => a + 1)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-line text-ink-secondary hover:text-ink-primary hover:border-line-strong transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden />
            Coba lagi
          </button>
          <a
            href={tvLink(tvSymbol)}
            rel="noopener nofollow"
            target="_blank"
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-line text-ink-secondary hover:text-ink-primary hover:border-line-strong transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" aria-hidden />
            Buka di TradingView
          </a>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={hostRef}
      id={hostId}
      className="tradingview-widget-container h-full w-full"
      role="region"
      aria-label={`Grafik lengkap ${symbol} dalam IDR`}
    />
  );
}

export function TradingViewTerminalChart({ symbol }: { symbol: AssetSymbol }) {
  const tvSymbol = TV_SYMBOLS[symbol];
  return (
    <div className="border border-line rounded-2xl bg-surface-1 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-line">
        <span className="inline-flex items-center gap-2 text-sm">
          <TokenIcon symbol={symbol} size={18} />
          <span className="text-ink-primary font-semibold">{symbol} / IDR</span>
          <span className="text-ink-muted text-xs hidden sm:inline">TradingView · IDR reference</span>
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs text-ink-secondary">
          <span className="w-1.5 h-1.5 rounded-full bg-[#4CAF6D] animate-pulse" aria-hidden />
          Live
        </span>
      </div>

      {/* Explicit height BEFORE the embed script runs (mobile capped,
          desktop follows the viewport under the sticky Navbar). */}
      <div className="h-72 lg:h-[clamp(32.5rem,calc(100vh-15rem),40.625rem)]">
        <ChartHost key={symbol} symbol={symbol} />
      </div>

      <p className="px-4 py-2.5 border-t border-line-subtle text-ink-muted text-[11px] leading-relaxed">
        {TV_DISCLAIMER}{' '}
        <a
          href={tvLink(tvSymbol)}
          rel="noopener nofollow"
          target="_blank"
          className="underline underline-offset-2 hover:text-ink-secondary"
        >
          Data TradingView
        </a>
      </p>
    </div>
  );
}
