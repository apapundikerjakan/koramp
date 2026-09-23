'use client';

/**
 * TerminalLayout — shared "trading terminal" shell for topup/sell.
 *
 * Two states, one animation (fade-in on chart appear, codebase idiom):
 * - Chart open (default desktop): left Advanced chart + right 420px column
 *   (form stacked over Ringkasan), no dead space on wide screens.
 * - Chart closed: chart unmounted, right column widens and centers
 *   (max-w-xl, reusing the legacy narrow width).
 * - Below lg: single column, chart (when open) on top capped at h-64,
 *   form + Ringkasan stacked below.
 *
 * Preference persists in localStorage (same try/catch idiom as the wallet's
 * last-chain key). Mobile defaults to closed so the form is visible first.
 */

import { useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { ShimmerText } from '@/components/ui/motion';
import { CHART_OPEN_KEY } from '@/lib/tradingView';

export function useChartToggle() {
  // true matches SSR/first paint; corrected on mount (no stored pref +
  // narrow viewport → closed). Effect-only correction avoids hydration mismatch.
  const [chartOpen, setChartOpen] = useState(true);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(CHART_OPEN_KEY);
      if (stored === '1') {
        setChartOpen(true);
        return;
      }
      if (stored === '0') {
        setChartOpen(false);
        return;
      }
      if (window.innerWidth < 1024) setChartOpen(false);
    } catch {
      /* storage unavailable — keep default */
    }
  }, []);

  const toggleChart = () => {
    setChartOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(CHART_OPEN_KEY, next ? '1' : '0');
      } catch {
        /* storage unavailable — session-only */
      }
      return next;
    });
  };

  return { chartOpen, toggleChart };
}

/**
 * TerminalGrid — replaces the old FormGrid (form + 380px aside).
 *
 * Same nesting shape (`<TerminalGrid …>{form}</TerminalGrid>`) so step
 * blocks only swap tags; Ringkasan stacks under the form in the right
 * column instead of a separate aside.
 *
 * Full-viewport mode: the grid fills its parent height (page is h-dvh with
 * overflow hidden — no page scroll). Each column scrolls internally:
 * chart column and form column get their own overflow-y-auto.
 */
export function TerminalGrid({
  open,
  chart,
  summary,
  children,
}: {
  open: boolean;
  chart: React.ReactNode;
  summary: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={
        open
          ? 'grid items-start gap-4 sm:gap-6 xl:grid-cols-[minmax(0,1fr)_440px] h-full min-h-0 overflow-y-auto lg:overflow-hidden'
          : 'block h-full min-h-0 overflow-y-auto'
      }
    >
      {open && (
        <div className="min-w-0 animate-fade-in lg:h-full lg:min-h-0 lg:overflow-y-auto">{chart}</div>
      )}
      <div className={open ? 'min-w-0 lg:h-full lg:min-h-0 lg:overflow-y-auto pb-4' : 'mx-auto w-full max-w-3xl'}>
        <div className="space-y-6">
          <div className="min-w-0">{children}</div>
          <div className="min-w-0">{summary}</div>
        </div>
      </div>
    </div>
  );
}

/** Chart show/hide toggle for the page header (shared by topup/sell). */
export function ChartToggleButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={open}
      aria-label={open ? 'Sembunyikan grafik harga' : 'Tampilkan grafik harga'}
      className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-line-subtle text-ink-secondary hover:text-ink-primary hover:border-line-strong transition-colors flex-shrink-0"
    >
      {open ? <EyeOff className="w-3.5 h-3.5" aria-hidden /> : <Eye className="w-3.5 h-3.5" aria-hidden />}
      <span className="hidden sm:inline">{open ? 'Sembunyikan' : 'Grafik'}</span>
    </button>
  );
}

/** Static loading skeleton for the dynamic ssr:false chart import. */
export function ChartPanelSkeleton() {
  return (
    <div className="border border-line rounded-2xl bg-surface-1 overflow-hidden" aria-hidden>
      <div className="px-4 py-3 border-b border-line">
        <ShimmerText>Memuat grafik…</ShimmerText>
      </div>
      <div className="h-72 lg:h-[clamp(32.5rem,calc(100vh-15rem),40.625rem)]" />
    </div>
  );
}
