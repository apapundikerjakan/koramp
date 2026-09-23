'use client';

/**
 * AnalyticsCharts — admin revenue/expense/sales/visits (recharts).
 * Styled with KORAMP tokens (surface bg, subtle grid, mono numerals),
 * NOT the default recharts theme.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import clsx from 'clsx';

type Range = '7d' | '30d' | '90d';

interface DayRow {
  date: string;
  revenue: number;
  expenses: number;
  topupVolume: number;
  topupCount: number;
  sellVolume: number;
  sellCount: number;
  visits: number;
}

const GRID = '#243026';
const TICK = '#5E6B60';
const TOOLTIP_STYLE = {
  backgroundColor: '#131916',
  border: '1px solid #2C3A2E',
  borderRadius: 12,
  fontSize: 12,
  color: '#F5F1E8',
} as const;

const compactIdr = (n: number) =>
  `Rp${new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 }).format(n)}`;
const fullIdr = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);
const shortDate = (iso: string) => {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
};

function ChartCard({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-1 border border-line-subtle rounded-2xl p-5">
      <p className="text-ink-primary font-semibold text-sm">{title}</p>
      <p className="text-ink-muted text-xs mt-0.5 mb-4">{hint}</p>
      {children}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className={clsx('bg-surface-1 border border-line-subtle rounded-2xl p-5 animate-pulse', i === 2 && 'lg:col-span-2')}>
          <div className="h-4 w-40 bg-line rounded mb-2" />
          <div className="h-3 w-56 bg-line rounded mb-4" />
          <div className="h-[240px] bg-line/60 rounded-xl" />
        </div>
      ))}
    </div>
  );
}

export function AnalyticsCharts() {
  const [range, setRange] = useState<Range>('7d');
  const [days, setDays] = useState<DayRow[] | null>(null);

  const load = useCallback(async (r: Range) => {
    setDays(null);
    try {
      const res = await fetch(`/api/admin/stats/timeseries?range=${r}`);
      const data = await res.json();
      if (res.ok && Array.isArray(data.days)) setDays(data.days);
      else setDays([]);
    } catch {
      setDays([]);
    }
  }, []);

  useEffect(() => {
    load(range);
  }, [range, load]);

  const empty = days !== null && days.every((d) => d.revenue === 0 && d.expenses === 0 && d.topupVolume === 0 && d.sellVolume === 0 && d.visits === 0);
  const totals = days === null ? null : {
    revenue: days.reduce((s, d) => s + d.revenue, 0),
    expenses: days.reduce((s, d) => s + d.expenses, 0),
    topup: days.reduce((s, d) => s + d.topupVolume, 0),
    sell: days.reduce((s, d) => s + d.sellVolume, 0),
    visits: days.reduce((s, d) => s + d.visits, 0),
  };

  return (
    <section aria-label="Analitik">
      <div className="flex items-center justify-between mb-3">
        <p className="text-ink-primary font-semibold text-sm">Analitik</p>
        <div className="flex rounded-xl overflow-hidden border border-line-subtle" role="group" aria-label="Rentang">
          {(['7d', '30d', '90d'] as Range[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              aria-pressed={range === r}
              className={clsx(
                'px-3.5 py-1.5 text-xs font-semibold transition-colors',
                range === r ? 'bg-[#C7A048]/15 text-[#D9B75F]' : 'text-ink-muted hover:text-ink-primary',
              )}
            >
              {r === '7d' ? '7 hari' : r === '30d' ? '30 hari' : '90 hari'}
            </button>
          ))}
        </div>
      </div>

      {days === null ? (
        <Skeleton />
      ) : (
        <>
          {empty && (
            <p className="text-ink-muted text-xs mb-3">Belum ada order COMPLETED atau kunjungan pada rentang ini, grafik akan terisi otomatis.</p>
          )}
          {/* Text alternative for charts (screen readers) */}
          {totals && !empty && (
            <ul className="sr-only">
              <li>Total pendapatan {range}: {fullIdr(totals.revenue)}</li>
              <li>Total pengeluaran {range}: {fullIdr(totals.expenses)}</li>
              <li>Volume penjualan {range}: {fullIdr(totals.topup)}</li>
              <li>Volume pembelian {range}: {fullIdr(totals.sell)}</li>
              <li>Total kunjungan {range}: {totals.visits}</li>
            </ul>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title="Pendapatan vs pengeluaran" hint="serviceFee COMPLETED vs networkFee + fee KiPay, per hari (IDR)">
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={days} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fill: TICK, fontSize: 11 }} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={24} />
                  <YAxis tickFormatter={compactIdr} tick={{ fill: TICK, fontSize: 11 }} tickLine={false} axisLine={false} width={64} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(l) => String(l)} formatter={(v, name) => [fullIdr(Number(v)), name]} />
                  <Legend wrapperStyle={{ fontSize: 12, color: '#9FAB9F' }} />
                  <Line type="monotone" dataKey="revenue" name="Pendapatan" stroke="#C7A048" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="expenses" name="Pengeluaran" stroke="#E15B4F" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Penjualan vs pembelian" hint="volume IDR top up vs sell COMPLETED, per hari">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={days} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barGap={3}>
                  <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fill: TICK, fontSize: 11 }} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={24} />
                  <YAxis tickFormatter={compactIdr} tick={{ fill: TICK, fontSize: 11 }} tickLine={false} axisLine={false} width={64} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(l) => String(l)} formatter={(v, name) => [fullIdr(Number(v)), name]} cursor={{ fill: 'rgba(245,241,232,0.04)' }} />
                  <Legend wrapperStyle={{ fontSize: 12, color: '#9FAB9F' }} />
                  <Bar dataKey="topupVolume" name="Penjualan (top up)" fill="#C7A048" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="sellVolume" name="Pembelian (sell)" fill="#2A7A58" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <div className="lg:col-span-2">
              <ChartCard title="Kunjungan web" hint="halaman publik per hari (tanpa data pribadi)">
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={days} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fill: TICK, fontSize: 11 }} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={24} />
                    <YAxis tick={{ fill: TICK, fontSize: 11 }} tickLine={false} axisLine={false} width={48} allowDecimals={false} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(l) => String(l)} formatter={(v) => [Number(v), 'Kunjungan']} />
                    <Line type="monotone" dataKey="visits" name="Kunjungan" stroke="#4A90A4" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
