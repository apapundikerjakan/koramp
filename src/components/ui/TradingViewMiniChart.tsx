'use client';

/**
 * TradingViewMiniChart — compact price widget for the ~380px Ringkasan sidebar.
 *
 * Uses the official TradingView Mini Symbol Overview EMBED
 * (https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.js),
 * which ships live TradingView data — NOT lightweight-charts (empty renderer).
 *
 * - Client-only: script injected in useEffect (needs window/document).
 * - Lazy: injects only after the section enters the viewport (IO + margin),
 *   so the third-party script never delays first paint. The display:none
 *   desktop/mobile duplicate therefore never double-loads.
 * - Themed: dark + transparent (panel surface shows through) + brass (#C7A048)
 *   trend line to match Kipramp tokens.
 * - Attribution link kept (free-widget license requirement) — never hidden.
 */

import { useEffect, useRef, useState } from 'react';
import type { AssetSymbol } from '@/lib/assets';
import { TV_SYMBOLS } from '@/lib/tradingView';

const SCRIPT_SRC =
  'https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.js';

const WIDGET_HEIGHT = 200;

export function TradingViewMiniChart({ symbol }: { symbol: AssetSymbol }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const tvSymbol = TV_SYMBOLS[symbol];

  // Lazy-mount: wait until scrolled into view.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Official embed pattern: JSON config as the script tag's own text content.
  useEffect(() => {
    if (!visible) return;
    const host = boxRef.current;
    if (!host) return;
    host.innerHTML = '';

    const widget = document.createElement('div');
    widget.className = 'tradingview-widget-container__widget';

    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.textContent = JSON.stringify({
      symbol: tvSymbol,
      width: '100%',
      height: WIDGET_HEIGHT,
      locale: 'id',
      dateRange: '1D',
      colorTheme: 'dark',
      trendLineColor: 'rgba(199, 160, 72, 1)', // --accent brass
      underLineColor: 'rgba(199, 160, 72, 0.25)',
      isTransparent: true,
      autosize: false,
      largeChartUrl: '',
    });

    const credit = document.createElement('div');
    credit.className = 'tradingview-widget-copyright';
    const link = document.createElement('a');
    link.href = `https://www.tradingview.com/symbols/${tvSymbol.replace(':', '-')}/`;
    link.rel = 'noopener nofollow';
    link.target = '_blank';
    const span = document.createElement('span');
    span.className = 'blue-text';
    span.textContent = `${tvSymbol} di TradingView`;
    link.appendChild(span);
    credit.appendChild(link);

    host.append(widget, script, credit);
    return () => {
      host.innerHTML = '';
    };
  }, [visible, tvSymbol]);

  return (
    <div
      ref={boxRef}
      className="w-full overflow-hidden"
      style={{ minHeight: WIDGET_HEIGHT }}
      role="region"
      aria-label={`Grafik harga referensi ${symbol} (USDT)`}
    />
  );
}
