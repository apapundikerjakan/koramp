'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowUpRight, ArrowDownRight, CheckCircle2, Clock,
  LogOut, RefreshCw, Wallet, AlertTriangle, TrendingUp, Key,
} from 'lucide-react';
import { RestrictedNotice } from '@/components/admin/AdminGate';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AdminStats {
  totalTopUps?: number;
  totalSells?: number;
  pendingTopUps?: number;
  pendingSells?: number;
  completedTopUps?: number;
  completedSells?: number;
}

interface WalletBalance {
  asset: string;
  network: string;
  address: string;
  balance: string;
  balanceIdr: string;
  pricePerUnit: string;
  status: 'ok' | 'error' | 'unconfigured';
  error?: string;
}

interface WalletData {
  wallets: WalletBalance[];
  totalIdr: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: string | number) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(Number(n));
}

function fmtCrypto(n: string | number, decimals = 6) {
  return parseFloat(Number(n).toFixed(decimals)).toString();
}

const ASSET_META: Record<string, { icon: string; color: string; bg: string; border: string }> = {
  SOL: { icon: '◎', color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/20' },
  ETH: { icon: 'Ξ',  color: 'text-blue-400',   bg: 'bg-blue-500/10',   border: 'border-blue-500/20'   },
  BNB: { icon: '⬡', color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' },
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const router = useRouter();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [walletData, setWalletData] = useState<WalletData | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<{ authenticated: boolean; admin?: boolean; restricted?: boolean; remaining?: string; retryAfter?: number; restrictionId?: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const loadWallets = useCallback(async () => {
    setWalletLoading(true);
    try {
      const res = await fetch('/api/admin/wallets/balance');
      const data = await res.json();
      if (res.ok) setWalletData(data);
    } catch {}
    finally { setWalletLoading(false); }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/stats');
      const data = await res.json();
      setStats(data);
    } catch {}
  }, []);

  useEffect(() => {
    fetch('/api/admin/session')
      .then(r => r.json())
      .then(data => {
        setSessionStatus(data);
        if (data.authenticated && data.admin) {
          Promise.all([loadStats(), loadWallets()]).finally(() => setLoading(false));
        } else {
          setLoading(false);
        }
      })
      .catch(() => {
        setSessionStatus({ authenticated: false });
        setLoading(false);
      });
  }, [loadStats, loadWallets]);

  const handleLogout = async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    window.location.href = '/admin/login';
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  if (sessionStatus?.restricted) {
    return (
      <RestrictedNotice
        remaining={typeof sessionStatus.remaining === 'string' ? sessionStatus.remaining : null}
        retryAfter={typeof sessionStatus.retryAfter === 'number' ? sessionStatus.retryAfter : null}
        restrictionId={typeof sessionStatus.restrictionId === 'string' ? sessionStatus.restrictionId : undefined}
      />
    );
  }

  if (!sessionStatus?.authenticated || !sessionStatus?.admin) {
    router.push('/admin/login');
    return null;
  }

  return (
    <div className="min-h-screen bg-[#0a0a1a]">
      {/* Nav */}
      <nav className="bg-[#0a0a1a] border-b border-[#1e1e45]">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <span className="text-white font-bold">KIPRAMP ADMIN</span>
          <button onClick={handleLogout}
            className="flex items-center gap-2 px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg text-sm transition-colors">
            <LogOut className="w-4 h-4" /> Logout
          </button>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-4 py-10 space-y-8">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-white">Admin Dashboard</h1>
          <p className="text-gray-400 text-sm mt-1">Kipramp Operations</p>
        </div>

        {/* ── Order Stats ──────────────────────────────────────────────────── */}
        {stats && (
          <section>
            <p className="text-gray-500 text-xs uppercase tracking-widest mb-3">Statistik Order</p>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              {[
                { label: 'Total Top Ups',   value: stats.totalTopUps ?? 0,     icon: ArrowUpRight,   color: 'text-blue-400',   bg: 'bg-blue-500/10'   },
                { label: 'Total Sells',     value: stats.totalSells ?? 0,      icon: ArrowDownRight, color: 'text-purple-400', bg: 'bg-purple-500/10' },
                { label: 'Pending Top Ups', value: stats.pendingTopUps ?? 0,   icon: Clock,          color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
                { label: 'Pending Sells',   value: stats.pendingSells ?? 0,    icon: Clock,          color: 'text-orange-400', bg: 'bg-orange-500/10' },
                { label: 'Done Top Ups',    value: stats.completedTopUps ?? 0, icon: CheckCircle2,   color: 'text-green-400',  bg: 'bg-green-500/10'  },
                { label: 'Done Sells',      value: stats.completedSells ?? 0,  icon: CheckCircle2,   color: 'text-green-400',  bg: 'bg-green-500/10'  },
              ].map(s => (
                <div key={s.label} className="bg-[#111128] border border-[#1e1e45] rounded-xl p-4">
                  <div className={`w-8 h-8 rounded-lg ${s.bg} flex items-center justify-center mb-3`}>
                    <s.icon className={`w-4 h-4 ${s.color}`} />
                  </div>
                  <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-gray-500 text-xs mt-1">{s.label}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Platform Wallet Balances ──────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Wallet className="w-4 h-4 text-brand-400" />
              <p className="text-white font-semibold text-sm">Saldo Platform (Hot Wallet)</p>
            </div>
            <button
              onClick={loadWallets}
              disabled={walletLoading}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-white transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${walletLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          {/* Total IDR banner */}
          {walletData && (
            <div className="bg-[#0b0b1f] border border-brand-600/20 rounded-xl px-5 py-4 mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-brand-400" />
                <span className="text-gray-400 text-sm">Total Nilai Aset</span>
              </div>
              <span className="text-white font-black text-xl">{fmt(walletData.totalIdr)}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {walletData?.wallets.map(w => {
              const meta = ASSET_META[w.asset] ?? { icon: '●', color: 'text-gray-400', bg: 'bg-gray-500/10', border: 'border-gray-500/20' };
              return (
                <div key={w.asset} className={`bg-[#111128] border rounded-xl p-5 ${
                  w.status === 'ok' ? 'border-[#1e1e45]' :
                  w.status === 'unconfigured' ? 'border-yellow-500/20' : 'border-red-500/20'
                }`}>
                  {/* Header */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div className={`w-9 h-9 rounded-xl ${meta.bg} border ${meta.border} flex items-center justify-center text-lg font-black ${meta.color}`}>
                        {meta.icon}
                      </div>
                      <div>
                        <p className={`font-bold text-sm ${meta.color}`}>{w.asset}</p>
                        <p className="text-gray-600 text-xs">{w.network}</p>
                      </div>
                    </div>
                    {w.status === 'ok' && (
                      <span className="text-xs text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded-full">Live</span>
                    )}
                    {w.status === 'unconfigured' && (
                      <span className="text-xs text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 px-2 py-0.5 rounded-full">Belum dikonfigurasi</span>
                    )}
                    {w.status === 'error' && (
                      <span className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded-full">Error</span>
                    )}
                  </div>

                  {/* Balance */}
                  {w.status === 'ok' ? (
                    <>
                      <p className={`text-2xl font-black ${meta.color} mb-0.5`}>
                        {fmtCrypto(w.balance)} {w.asset}
                      </p>
                      <p className="text-white font-semibold text-sm">{fmt(w.balanceIdr)}</p>
                      <p className="text-gray-600 text-xs mt-2">
                        1 {w.asset} = {fmt(w.pricePerUnit)}
                      </p>
                      {/* Address */}
                      <div className="mt-3 pt-3 border-t border-[#1e1e45]">
                        <p className="text-gray-600 text-xs mb-1">Alamat wallet</p>
                        <p className="text-gray-400 font-mono text-xs break-all">
                          {w.address.slice(0, 12)}...{w.address.slice(-8)}
                        </p>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-start gap-2 mt-2">
                      <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
                      <p className="text-gray-500 text-xs">{w.error}</p>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Loading skeleton */}
            {walletLoading && !walletData && [0, 1, 2].map(i => (
              <div key={i} className="bg-[#111128] border border-[#1e1e45] rounded-xl p-5 animate-pulse">
                <div className="h-9 w-9 rounded-xl bg-[#1e1e45] mb-4" />
                <div className="h-6 w-24 bg-[#1e1e45] rounded mb-2" />
                <div className="h-4 w-20 bg-[#1e1e45] rounded" />
              </div>
            ))}
          </div>

          <p className="text-gray-600 text-xs mt-3">
            Saldo diambil langsung dari blockchain. Harga menggunakan data live CoinGecko.
          </p>
        </section>

        {/* ── Quick Nav ─────────────────────────────────────────────────────── */}
        <section>
          <p className="text-gray-500 text-xs uppercase tracking-widest mb-3">Menu</p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {[
              { href: '/admin/orders/topup', label: 'Top Up Orders', desc: 'Kelola order top up',     icon: ArrowUpRight   },
              { href: '/admin/orders/sell',  label: 'Sell Orders',   desc: 'Kelola order sell',       icon: ArrowDownRight },
              { href: '/admin/settings',     label: 'Settings',      desc: 'Harga & konfigurasi',     icon: TrendingUp     },
              { href: '/admin/security',     label: 'Security',      desc: 'Event & IP bans',         icon: AlertTriangle  },
              { href: '/admin/settings#access-key', label: 'Access Key', desc: 'Lihat & generate key', icon: Key           },
            ].map(item => (
              <Link key={item.href} href={item.href}
                className="bg-[#111128] border border-[#1e1e45] rounded-xl p-5 hover:border-[#2a2a5c] transition-all group">
                <item.icon className="w-5 h-5 text-gray-500 group-hover:text-brand-400 transition-colors mb-3" />
                <h3 className="text-white font-semibold text-sm">{item.label}</h3>
                <p className="text-gray-500 text-xs mt-1">{item.desc}</p>
              </Link>
            ))}
          </div>
        </section>

      </div>
    </div>
  );
}
