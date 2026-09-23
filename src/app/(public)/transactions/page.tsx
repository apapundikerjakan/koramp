'use client';

/**
 * /transactions — PUBLIC GLOBAL KORAMP LEDGER.
 *
 * "All transactions/orders created through KORAMP." No wallet required, no
 * wallet filtering, no blockchain scanning. Sole source: GET /api/transactions
 * (TopUpOrder + SellOrder, safe public DTO, masked wallets). Wallet-scoped
 * history stays in WalletSidebar; blockchain activity stays on explorers.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/layout/Navbar';
import type { PublicTransaction } from '@/app/api/transactions/route';
import { ArrowDownLeft, ArrowUpRight, RefreshCw, Receipt, Search } from 'lucide-react';
import clsx from 'clsx';

const PAGE_SIZE = 20;

function fmtIDR(n: string): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return n;
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
}

function fmtAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'baru saja';
  if (min < 60) return `${min} mnt lalu`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} jam lalu`;
  return `${Math.floor(h / 24)} hari lalu`;
}

export default function TransactionsPage() {
  const router = useRouter();
  const [items, setItems] = useState<PublicTransaction[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [side, setSide] = useState('');
  const [asset, setAsset] = useState('');
  const [network, setNetwork] = useState('');
  const [status, setStatus] = useState('');
  const [applied, setApplied] = useState({ q: '', side: '', asset: '', network: '', status: '' });

  const load = useCallback(async (p: number, f: typeof applied) => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams({ page: String(p), limit: String(PAGE_SIZE) });
      if (f.q) sp.set('q', f.q);
      if (f.side) sp.set('side', f.side);
      if (f.asset) sp.set('asset', f.asset);
      if (f.network) sp.set('network', f.network);
      if (f.status) sp.set('status', f.status);
      const res = await fetch(`/api/transactions?${sp.toString()}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) {
        setError('Gagal memuat transaksi. Coba lagi.');
        setItems([]);
        return;
      }
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotalPages(Number(data.totalPages) || 1);
      setTotal(Number(data.total) || 0);
      setPage(Number(data.page) || p);
    } catch {
      setError('Gagal terhubung ke server.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(1, applied);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFilters = () => {
    const f = { q: q.trim(), side, asset, network, status: status.trim() };
    setApplied(f);
    void load(1, f);
  };

  const resetFilters = () => {
    setQ(''); setSide(''); setAsset(''); setNetwork(''); setStatus('');
    const f = { q: '', side: '', asset: '', network: '', status: '' };
    setApplied(f);
    void load(1, f);
  };

  const gotoPage = (p: number) => {
    if (p < 1 || p > totalPages || p === page) return;
    void load(p, applied);
  };

  const statusColor = (s: string) =>
    s === 'COMPLETED' ? 'text-green-400'
    : ['FAILED', 'EXPIRED', 'CANCELLED', 'REFUNDED', 'PAYMENT_FAILED', 'CRYPTO_FAILED', 'PAYOUT_FAILED'].includes(s)
      ? 'text-red-400'
      : 'text-yellow-400';

  const renderRow = (o: PublicTransaction) => {
    const isBuy = o.side === 'BUY';
    const pair = isBuy ? `IDR → ${o.assetSymbol}` : `${o.assetSymbol} → IDR`;
    const amount = isBuy ? fmtIDR(o.idrAmount) : `${parseFloat(Number(o.cryptoAmount).toFixed(8))} ${o.assetSymbol}`;
    return (
      <div key={o.publicId} className="bg-surface-1 border border-line-subtle rounded-2xl p-4">
        {/* Mobile card */}
        <div className="md:hidden space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-white text-sm font-bold">{o.side}</p>
            <p className={clsx('text-[11px] font-bold', statusColor(o.status))}>{o.status.replace(/_/g, ' ')}</p>
          </div>
          <p className="text-gray-300 text-sm">{pair}</p>
          <p className="text-white font-bold text-sm tnum">{amount}</p>
          <p className="text-gray-600 text-xs font-mono">{o.maskedWallet} · {fmtAgo(o.createdAt)}</p>
          <div className="flex items-center justify-between pt-1">
            <p className="text-gray-600 text-xs font-mono">{o.orderNumber}</p>
            <button onClick={() => router.push(`/order/${o.publicId}`)} className="text-brand-400 text-xs font-semibold">View →</button>
          </div>
        </div>
        {/* Desktop row */}
        <div className="hidden md:grid md:grid-cols-[90px_1fr_140px_130px_120px_110px_70px] md:items-center md:gap-3">
          <p className="text-white text-sm font-bold flex items-center gap-2">
            <span className={clsx('w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0', isBuy ? 'bg-brand-600/15 text-brand-400' : 'bg-green-600/15 text-green-400')}>
              {isBuy ? <ArrowDownLeft className="w-3.5 h-3.5" /> : <ArrowUpRight className="w-3.5 h-3.5" />}
            </span>
            {o.side}
          </p>
          <div className="min-w-0">
            <p className="text-gray-200 text-sm truncate">{pair} · {o.network}</p>
            <p className="text-gray-600 text-xs font-mono truncate">{o.orderNumber}</p>
          </div>
          <p className="text-white text-sm font-bold tnum truncate">{amount}</p>
          <p className="text-gray-400 text-xs font-mono truncate" title="Masked wallet address">{o.maskedWallet}</p>
          <p className={clsx('text-xs font-bold', statusColor(o.status))}>{o.status.replace(/_/g, ' ')}</p>
          <p className="text-gray-600 text-xs">{fmtAgo(o.createdAt)}</p>
          <button onClick={() => router.push(`/order/${o.publicId}`)} className="text-brand-400 text-xs font-semibold text-right">View →</button>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-dvh flex flex-col bg-base">
      <Navbar />
      <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 py-6 sm:py-8 flex-1 w-full">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-brand-600/20 rounded-xl flex items-center justify-center flex-shrink-0">
              <Receipt className="w-4 h-4 text-brand-400" />
            </div>
            <h1 className="text-xl font-semibold tracking-[-0.02em] text-white">Transactions</h1>
          </div>
          <button
            onClick={() => { void load(page, applied); }}
            aria-label="Muat ulang transaksi"
            className="p-2 text-gray-500 hover:text-white"
          >
            <RefreshCw className={clsx('w-4 h-4', loading && 'animate-spin')} />
          </button>
        </div>
        <p className="text-gray-500 text-xs sm:pl-11 mb-5">
          Global KORAMP ledger — semua order yang dibuat melalui KORAMP. Tanpa koneksi wallet.
        </p>

        {/* Filters */}
        <div className="bg-surface-1 border border-line-subtle rounded-2xl p-3 sm:p-4 mb-4 space-y-2">
          <div className="relative">
            <Search className="w-4 h-4 text-gray-600 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') applyFilters(); }}
              placeholder="Cari order number / publicId / TX hash / wallet…"
              aria-label="Cari transaksi"
              className="input-field text-sm pl-9"
              maxLength={100}
            />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <select value={side} onChange={(e) => setSide(e.target.value)} aria-label="Filter BUY/SELL" className="input-field text-sm">
              <option value="">BUY + SELL</option>
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
            </select>
            <select value={asset} onChange={(e) => setAsset(e.target.value)} aria-label="Filter asset" className="input-field text-sm">
              <option value="">Semua asset</option>
              <option value="SOL">SOL</option>
              <option value="ETH">ETH</option>
              <option value="BNB">BNB</option>
            </select>
            <select value={network} onChange={(e) => setNetwork(e.target.value)} aria-label="Filter network" className="input-field text-sm">
              <option value="">Semua network</option>
              <option value="SOLANA">Solana</option>
              <option value="BASE">Base</option>
              <option value="BSC">BSC</option>
            </select>
            <input value={status} onChange={(e) => setStatus(e.target.value)} placeholder="Status…" aria-label="Filter status" className="input-field text-sm" maxLength={40} />
          </div>
          <div className="flex gap-2">
            <button onClick={applyFilters} className="btn-primary text-sm px-5 py-2">Cari</button>
            <button onClick={resetFilters} className="btn-ghost text-sm px-4 py-2">Reset</button>
          </div>
        </div>

        {loading && items.length === 0 ? (
          <p className="text-gray-500 text-sm" role="status">Memuat transaksi KORAMP…</p>
        ) : error ? (
          <div className="bg-surface-1 border border-red-500/20 rounded-2xl p-8 text-center">
            <p className="text-red-300 text-sm">{error}</p>
            <button onClick={() => { void load(page, applied); }} className="mt-3 text-brand-400 text-xs font-semibold underline">Coba lagi →</button>
          </div>
        ) : items.length === 0 ? (
          <div className="bg-surface-1 border border-line-subtle rounded-2xl p-8 text-center">
            <p className="text-white font-semibold text-sm">Belum ada transaksi KORAMP.</p>
          </div>
        ) : (
          <>
            <p className="text-gray-600 text-xs mb-2">{total} transaksi · halaman {page}/{totalPages}</p>
            <div className="space-y-2">{items.map(renderRow)}</div>
            <div className="flex items-center justify-between mt-4">
              <button
                onClick={() => gotoPage(page - 1)}
                disabled={page <= 1 || loading}
                className="btn-ghost text-sm px-4 py-2 disabled:opacity-40"
              >
                ← Sebelumnya
              </button>
              <p className="text-gray-600 text-xs">Halaman {page} dari {totalPages}</p>
              <button
                onClick={() => gotoPage(page + 1)}
                disabled={page >= totalPages || loading}
                className="btn-ghost text-sm px-4 py-2 disabled:opacity-40"
              >
                Berikutnya →
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
