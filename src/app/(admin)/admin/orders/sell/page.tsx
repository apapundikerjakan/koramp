'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AdminNavbar, MaskedAccount } from '@/components/admin/AdminNavbar';
import { RestrictedNotice } from '@/components/admin/AdminGate';
import { formatIDR, formatCrypto, formatDate } from '@/lib/format';
import { StatusBadge } from '@/components/ui/StatusBadge';
import Link from 'next/link';
import { ArrowLeft, RefreshCw, LogOut, Search, X, Copy, Check, Play, Banknote } from 'lucide-react';
import { toast } from 'sonner';

interface Order {
  id: string;
  orderNumber: string;
  publicId: string;
  assetSymbol: string;
  network: string;
  cryptoAmount: string | number;
  totalIdrPayout: string | number;
  status: string;
  createdAt: string;
  walletAddress: string;
  payoutBankName?: string | null;
  payoutAccountNumber?: string | null;
  payoutAccountName?: string | null;
}

const STATUS_FILTERS = ['', 'AWAITING_CRYPTO', 'CRYPTO_DETECTED', 'CRYPTO_CONFIRMED', 'PAYOUT_PROCESSING', 'PAYOUT_FAILED', 'COMPLETED'];

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button onClick={copy} className="ml-1 text-gray-600 hover:text-gray-300 transition-colors" title="Copy">
      {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

export default function AdminSellPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [total, setTotal] = useState(0);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [restriction, setRestriction] = useState<{ remaining?: string | null; retryAfter?: number | null; restrictionId?: string } | null>(null);

  const load = useCallback(async (s: string, q: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (s) params.set('status', s);
      if (q) params.set('search', q);
      const res = await fetch(`/api/admin/orders/sell?${params}`);
      const d = await res.json();
      setOrders(d.orders ?? []);
      setTotal(d.total ?? 0);
    } catch {
      toast.error('Gagal memuat data');
    } finally {
      setLoading(false);
    }
  }, []);

  // Check session once on mount
  useEffect(() => {
    fetch('/api/admin/session')
      .then(r => r.json())
      .then(data => {
        setSessionChecked(true);
        if (data.restricted) {
          setRestriction({ remaining: data.remaining ?? null, retryAfter: data.retryAfter ?? null, restrictionId: data.restrictionId });
        } else if (data.authenticated && data.admin) {
          setAuthed(true);
        } else {
          router.push('/admin/login');
        }
      })
      .catch(() => router.push('/admin/login'));
  }, [router]);

  // Reload whenever status or search changes (after auth)
  useEffect(() => {
    if (authed) load(status, search);
  }, [authed, status, search, load]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput.trim());
  };

  const clearSearch = () => {
    setSearchInput('');
    setSearch('');
  };

  const confirmCrypto = async (id: string, publicId: string) => {
    try {
      // First try auto-scan via poll-deposit (no txHash needed)
      const pollRes = await fetch(`/api/orders/${publicId}/poll-deposit`, { method: 'POST' });
      const pollData = await pollRes.json();

      if (pollData.confirmed || pollData.status === 'CRYPTO_CONFIRMED') {
        toast.success(`Dikonfirmasi otomatis! TX: ${pollData.txHash?.slice(0, 16)}...`);
        load(status, search);
        return;
      }

      if (pollData.found && pollData.status === 'CRYPTO_DETECTED') {
        // Found but not enough confirmations — show info
        toast.info(`Transaksi terdeteksi (${pollData.confirmations}/${pollData.requiredConfirmations} konfirmasi). Coba lagi sebentar.`);
        load(status, search);
        return;
      }

      // Auto-scan found nothing — ask admin for manual txHash as fallback
      const txHash = window.prompt(
        'Transaksi belum terdeteksi otomatis.\n\nMasukkan TX Hash secara manual (atau kosongkan untuk tetap scan):',
      );

      // If admin cancelled the prompt entirely, abort
      if (txHash === null) return;

      const res = await fetch(`/api/admin/orders/sell/${id}/confirm-crypto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txHash: txHash.trim() || undefined }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.autoScanned
          ? `Dikonfirmasi via scan! TX: ${data.txHash?.slice(0, 16)}...`
          : 'Dikonfirmasi & payout dipicu');
        load(status, search);
      } else {
        toast.error(data.error?.message ?? 'Gagal konfirmasi');
      }
    } catch {
      toast.error('Network error');
    }
  };

  const confirmPayout = async (id: string) => {
    const providerRef = window.prompt('Referensi transfer (opsional, misal: nomor bukti transfer):') ?? '';
    if (providerRef === null) return; // user cancelled
    try {
      const res = await fetch(`/api/admin/orders/sell/${id}/confirm-payout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerRef: providerRef.trim() || undefined }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success('Payout dikonfirmasi — order selesai!');
        load(status, search);
      } else {
        toast.error(data.error?.message ?? 'Gagal konfirmasi payout');
      }
    } catch {
      toast.error('Network error');
    }
  };

  const handleLogout = async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    router.push('/admin/login');
  };

  if (restriction) return <RestrictedNotice remaining={restriction.remaining} retryAfter={restriction.retryAfter} restrictionId={restriction.restrictionId} />;
  if (!sessionChecked || !authed) return null;

  return (
    <div className="min-h-screen">
      <AdminNavbar />
      <div className="max-w-7xl mx-auto px-4 py-10">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link href="/admin" className="text-gray-500 hover:text-white">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <h1 className="text-xl font-bold text-white">Sell Orders</h1>
          <span className="text-gray-500 text-sm ml-1">({total})</span>
          <button
            onClick={() => load(status, search)}
            className="ml-auto btn-ghost p-2"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={handleLogout} className="btn-ghost p-2 text-red-400" title="Logout">
            <LogOut className="w-4 h-4" />
          </button>
        </div>

        {/* Search bar */}
        <form onSubmit={handleSearch} className="mb-4">
          <div className="flex gap-2">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="text"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                placeholder="Cari Order ID, publicId, atau wallet address..."
                className="w-full pl-9 pr-9 py-2 bg-surface-2 border border-line rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500/50"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <button
              type="submit"
              className="px-4 py-2 bg-brand-600/20 hover:bg-brand-600/30 text-brand-400 border border-brand-600/30 rounded-lg text-sm font-medium transition-colors"
            >
              Cari
            </button>
          </div>
          {search && (
            <p className="text-xs text-gray-500 mt-1.5">
              Hasil untuk: <span className="text-brand-400 font-mono">&quot;{search}&quot;</span>
              <button onClick={clearSearch} className="ml-2 text-gray-600 hover:text-gray-300 underline">hapus</button>
            </p>
          )}
        </form>

        {/* Status filters */}
        <div className="flex gap-2 overflow-x-auto pb-2 mb-6">
          {STATUS_FILTERS.map(s => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors ${
                status === s
                  ? 'bg-brand-600/20 text-brand-400 border-brand-600/30'
                  : 'text-gray-500 border-line hover:text-gray-300'
              }`}
            >
              {s || 'All'}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 border-b border-line">
                <th className="text-left pb-3 font-medium">Order</th>
                <th className="text-left pb-3 font-medium">Order ID</th>
                <th className="text-left pb-3 font-medium">User</th>
                <th className="text-left pb-3 font-medium">Aset</th>
                <th className="text-right pb-3 font-medium">Crypto</th>
                <th className="text-right pb-3 font-medium">IDR Payout</th>
                <th className="text-left pb-3 font-medium">Bank</th>
                <th className="text-center pb-3 font-medium">Status</th>
                <th className="text-left pb-3 font-medium">Tanggal</th>
                <th className="text-center pb-3 font-medium">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {orders.map(o => (
                <tr key={o.id} className="hover:bg-white/[0.02]">

                  {/* Order Number */}
                  <td className="py-3 pr-4">
                    <Link
                      href={`/order/${o.publicId}`}
                      target="_blank"
                      className="font-mono text-xs text-brand-400 hover:text-brand-300 hover:underline"
                    >
                      {o.orderNumber}
                    </Link>
                  </td>

                  {/* Order ID (publicId) */}
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-0.5">
                      <span className="font-mono text-xs text-gray-400 bg-surface-2 border border-line rounded px-1.5 py-0.5">
                        {o.publicId}
                      </span>
                      <CopyButton value={o.publicId} />
                    </div>
                  </td>

                  {/* User */}
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-0.5">
                      <p className="text-white text-xs font-mono">
                        {o.walletAddress.slice(0, 6)}...{o.walletAddress.slice(-4)}
                      </p>
                      <CopyButton value={o.walletAddress} />
                    </div>
                  </td>

                  {/* Asset */}
                  <td className="py-3 pr-4">
                    <span className="text-white font-medium">{o.assetSymbol}</span>
                    <span className="text-gray-500 text-xs ml-1">{o.network}</span>
                  </td>

                  {/* Crypto */}
                  <td className="py-3 pr-4 text-right text-gray-300">
                    {formatCrypto(o.cryptoAmount)} {o.assetSymbol}
                  </td>

                  {/* IDR Payout */}
                  <td className="py-3 pr-4 text-right text-white font-medium">
                    {formatIDR(o.totalIdrPayout)}
                  </td>

                  {/* Bank info */}
                  <td className="py-3 pr-4">
                    {o.payoutBankName ? (
                      <div>
                        <p className="text-gray-300 text-xs font-medium">{o.payoutBankName}</p>
                        <MaskedAccount value={o.payoutAccountNumber} />
                        <p className="text-gray-600 text-xs">{o.payoutAccountName}</p>
                      </div>
                    ) : (
                      <span className="text-gray-600 text-xs">—</span>
                    )}
                  </td>

                  {/* Status */}
                  <td className="py-3 text-center">
                    <StatusBadge status={o.status} type="SELL" />
                  </td>

                  {/* Date */}
                  <td className="py-3 text-gray-500 text-xs whitespace-nowrap">
                    {formatDate(o.createdAt)}
                  </td>

                  <td className="py-3 text-center">
                    {o.status === 'AWAITING_CRYPTO' && (
                      <button
                        onClick={() => confirmCrypto(o.id, o.publicId)}
                        className="btn-secondary text-xs py-1 px-2 flex items-center gap-1 mx-auto"
                      >
                        <Play className="w-3 h-3" />
                        Scan & Confirm
                      </button>
                    )}
                    {o.status === 'CRYPTO_DETECTED' && (
                      <button
                        onClick={() => confirmCrypto(o.id, o.publicId)}
                        className="btn-secondary text-xs py-1 px-2 flex items-center gap-1 mx-auto border-yellow-600/30 text-yellow-400"
                      >
                        <Play className="w-3 h-3" />
                        Re-check
                      </button>
                    )}
                    {['PAYOUT_PROCESSING', 'PAYOUT_FAILED'].includes(o.status) && (
                      <button
                        onClick={() => confirmPayout(o.id)}
                        className="btn-secondary text-xs py-1 px-2 flex items-center gap-1 mx-auto border-green-600/30 text-green-400"
                      >
                        <Banknote className="w-3 h-3" />
                        Konfirmasi Payout
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {loading && (
            <div className="text-center py-12 text-gray-500 text-sm">Memuat...</div>
          )}
          {!loading && orders.length === 0 && (
            <div className="text-center py-12 text-gray-500 text-sm">
              {search ? `Tidak ada order untuk "${search}"` : 'Tidak ada order'}
            </div>
          )}
        </div>

        {/* Pagination info */}
        {total > 0 && (
          <p className="text-xs text-gray-600 mt-4 text-right">
            Menampilkan {orders.length} dari {total} order
          </p>
        )}
      </div>
    </div>
  );
}






