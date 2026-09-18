'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, RefreshCw, LogOut, Save, TrendingUp, Settings2,
  AlertCircle, CheckCircle2, Key, Copy, Check,
} from 'lucide-react';
import { toast } from 'sonner';
import { RestrictedNotice } from '@/components/admin/AdminGate';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PriceInfo {
  price: string;
  ageSeconds: number;
  source: 'live' | 'stale' | 'fallback';
}

interface GlobalFee {
  serviceFeeRate: string;
  networkFeeRate: string;
  taxRate: string;
  minOrderIdr: string;
  maxOrderIdr: string;
  solAtaFeeIdr: string;
}

interface KeyStatus {
  keyVersion: number;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  totpEnabled: boolean;
}

const ASSETS = ['SOL', 'ETH', 'BNB'] as const;
const ASSET_ICONS: Record<string, string>  = { SOL: '◎', ETH: 'Ξ', BNB: '⬡' };
const ASSET_COLORS: Record<string, string> = {
  SOL: 'text-purple-400', ETH: 'text-blue-400', BNB: 'text-yellow-400',
};

function fmt(n: string | number) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(Number(n));
}

function pct(v: string) {
  return `${(parseFloat(v || '0') * 100).toFixed(2)}%`;
}

// ─── FeeInput helper ──────────────────────────────────────────────────────────
function FeeInput({
  label, hint, value, step, onChange,
}: {
  label: string; hint?: string; value: string; step: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-gray-400 text-xs font-medium mb-1">{label}</label>
      <input
        type="number" step={step} min="0"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 bg-base border border-line-strong rounded-lg text-white text-sm focus:outline-none focus:border-brand-500/50"
      />
      {hint && <p className="text-gray-600 text-xs mt-0.5">{hint}</p>}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminSettingsPage() {
  const router = useRouter();
  const [sessionChecked, setSessionChecked] = useState(false);
  const [authed, setAuthed]       = useState(false);
  const [restriction, setRestriction] = useState<{
    remaining?: string | null; retryAfter?: number | null; restrictionId?: string
  } | null>(null);

  // Prices
  const [prices, setPrices]           = useState<Record<string, PriceInfo>>({});
  const [priceLoading, setPriceLoading] = useState(false);

  // Global fee form
  const [fee, setFee]         = useState<GlobalFee>({
    serviceFeeRate: '0.005',
    networkFeeRate: '0.001',
    taxRate: '0.001',
    minOrderIdr: '50000',
    maxOrderIdr: '100000000',
    solAtaFeeIdr: '0',
  });
  const [feeLoading, setFeeLoading] = useState(false);
  const [savingFee, setSavingFee]   = useState(false);

  // Admin key
  const [keyStatus, setKeyStatus]   = useState<KeyStatus | null>(null);
  const [keyLoading, setKeyLoading] = useState(false);
  const [rotating, setRotating]     = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [newKey, setNewKey]         = useState<string | null>(null);
  const [copiedKey, setCopiedKey]   = useState(false);

  // Session check
  useEffect(() => {
    fetch('/api/admin/session')
      .then(r => r.json())
      .then(data => {
        setSessionChecked(true);
        if (data.restricted) setRestriction({ remaining: data.remaining ?? null, retryAfter: data.retryAfter ?? null, restrictionId: data.restrictionId });
        else if (data.authenticated && data.admin) setAuthed(true);
        else router.push('/admin/login');
      })
      .catch(() => router.push('/admin/login'));
  }, [router]);

  // Load prices
  const loadPrices = useCallback(async () => {
    setPriceLoading(true);
    try {
      const res  = await fetch('/api/admin/prices');
      const data = await res.json();
      setPrices(data.prices ?? {});
    } catch { toast.error('Gagal memuat harga'); }
    finally { setPriceLoading(false); }
  }, []);

  const refreshPrices = async () => {
    setPriceLoading(true);
    try {
      const res  = await fetch('/api/admin/prices', { method: 'POST' });
      const data = await res.json();
      if (res.ok) { toast.success('Harga diperbarui dari CoinGecko'); await loadPrices(); }
      else toast.error(data.error?.message ?? 'Gagal refresh harga');
    } catch { toast.error('Network error'); }
    finally { setPriceLoading(false); }
  };

  // Load global fee
  const loadFees = useCallback(async () => {
    setFeeLoading(true);
    try {
      const res  = await fetch('/api/admin/fees');
      const data = await res.json();
      if (res.ok && data.global) setFee(data.global);
    } catch {}
    finally { setFeeLoading(false); }
  }, []);

  // Load admin key status
  const loadKeyStatus = useCallback(async () => {
    setKeyLoading(true);
    try {
      const res  = await fetch('/api/admin/keys');
      const data = await res.json();
      if (res.ok) setKeyStatus(data);
      else if (res.status === 401) router.push('/admin/login');
    } catch { toast.error('Gagal memuat status access key'); }
    finally { setKeyLoading(false); }
  }, [router]);

  useEffect(() => {
    if (authed) { loadPrices(); loadFees(); loadKeyStatus(); }
  }, [authed, loadPrices, loadFees, loadKeyStatus]);

  // Save global fee (bulk update all 6 configs)
  const saveFee = async () => {
    setSavingFee(true);
    try {
      const res  = await fetch('/api/admin/fees/bulk', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fee),
      });
      const data = await res.json();
      if (res.ok) toast.success(`Fee disimpan untuk semua aset (${data.updated} konfigurasi)`);
      else toast.error(data.error?.message ?? 'Gagal menyimpan fee');
    } catch { toast.error('Network error'); }
    finally { setSavingFee(false); }
  };

  // Key rotation
  const handleRotateKey = async () => {
    if (!confirmRotate) { setConfirmRotate(true); return; }
    setRotating(true);
    try {
      const res  = await fetch('/api/admin/keys', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setNewKey(data.adminKey);
        setConfirmRotate(false);
        toast.success(`Key v${data.keyVersion} aktif — key lama langsung mati`);
        await loadKeyStatus();
      } else { toast.error(data.error?.message ?? 'Gagal generate key'); setConfirmRotate(false); }
    } catch { toast.error('Network error'); setConfirmRotate(false); }
    finally { setRotating(false); }
  };

  const copyNewKey = () => {
    if (!newKey) return;
    navigator.clipboard.writeText(newKey);
    setCopiedKey(true);
    toast.success('Key disalin — simpan di tempat aman!');
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const handleLogout = async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    router.push('/admin/login');
  };

  if (restriction) return <RestrictedNotice remaining={restriction.remaining} retryAfter={restriction.retryAfter} restrictionId={restriction.restrictionId} />;
  if (!sessionChecked || !authed) return null;

  return (
    <div className="min-h-screen bg-base">
      {/* Nav */}
      <nav className="bg-base border-b border-line">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <span className="text-white font-bold">KIPRAMP ADMIN</span>
          <button onClick={handleLogout} className="flex items-center gap-2 px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg text-sm transition-colors">
            <LogOut className="w-4 h-4" /> Logout
          </button>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-4 py-10 space-y-8">

        {/* Header */}
        <div className="flex items-center gap-3">
          <Link href="/admin" className="text-gray-500 hover:text-white">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <Settings2 className="w-5 h-5 text-brand-400" />
          <h1 className="text-xl font-bold text-white">Settings</h1>
        </div>

        {/* Admin Access Key */}
        <section id="access-key" className="scroll-mt-6">
          <div className="flex items-center gap-2 mb-4">
            <Key className="w-4 h-4 text-brand-400" />
            <h2 className="text-white font-semibold">Admin Access Key</h2>
          </div>
          <div className="bg-surface-2 border border-line rounded-xl p-5 space-y-4">
            {keyLoading && !keyStatus ? (
              <p className="text-gray-500 text-sm">Memuat status key...</p>
            ) : keyStatus ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div><p className="text-gray-500 text-xs mb-0.5">Versi aktif</p><p className="text-white font-bold">v{keyStatus.keyVersion}</p></div>
                  <div><p className="text-gray-500 text-xs mb-0.5">Status</p>
                    <p className={keyStatus.isActive ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold'}>
                      {keyStatus.isActive ? '● Aktif' : '● Nonaktif'}
                    </p>
                  </div>
                  <div><p className="text-gray-500 text-xs mb-0.5">Dibuat</p><p className="text-gray-300 text-xs">{new Date(keyStatus.createdAt).toLocaleString('id-ID')}</p></div>
                  <div><p className="text-gray-500 text-xs mb-0.5">Login terakhir</p>
                    <p className="text-gray-300 text-xs">{keyStatus.lastLoginAt ? new Date(keyStatus.lastLoginAt).toLocaleString('id-ID') : 'Belum pernah'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-gray-500">Authenticator 2FA:</span>
                  <span className={keyStatus.totpEnabled ? 'text-green-400 font-semibold' : 'text-yellow-400 font-semibold'}>
                    {keyStatus.totpEnabled ? 'Aktif (login butuh kode 6 digit)' : 'Mati (mode kunci-saja)'}
                  </span>
                </div>
                {newKey && (
                  <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-xl space-y-3">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-400" />
                      <p className="text-green-400 text-sm font-semibold">Key baru aktif — salin sekarang!</p>
                    </div>
                    <div className="flex items-center gap-2 p-3 bg-base rounded-lg border border-green-500/20">
                      <p className="text-white font-mono text-xs flex-1 break-all">{newKey}</p>
                      <button onClick={copyNewKey} className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded-lg text-xs font-semibold transition-colors">
                        {copiedKey ? <><Check className="w-3.5 h-3.5" /> Disalin!</> : <><Copy className="w-3.5 h-3.5" /> Salin</>}
                      </button>
                    </div>
                    <p className="text-yellow-300 text-xs">Key lama sudah mati dan key ini tidak bisa ditampilkan lagi.</p>
                    <button onClick={() => setNewKey(null)} className="text-gray-500 hover:text-white text-xs">Sudah tersimpan — sembunyikan</button>
                  </div>
                )}
                {!newKey && (
                  !confirmRotate ? (
                    <button onClick={handleRotateKey} disabled={rotating} className="flex items-center gap-2 px-4 py-2.5 bg-brand-600/20 hover:bg-brand-600/30 text-brand-400 border border-brand-600/30 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50">
                      <Key className="w-4 h-4" /> Generate Key Baru
                    </button>
                  ) : (
                    <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl space-y-3">
                      <p className="text-red-300 text-sm">Key lama akan <strong>langsung mati</strong>. Lanjut?</p>
                      <div className="flex gap-2">
                        <button onClick={handleRotateKey} disabled={rotating} className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 disabled:bg-gray-600 text-white rounded-lg text-sm font-semibold">
                          {rotating ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Membuat...</> : 'Ya, generate sekarang'}
                        </button>
                        <button onClick={() => setConfirmRotate(false)} disabled={rotating} className="px-4 py-2 text-gray-400 hover:text-white text-sm">Batal</button>
                      </div>
                    </div>
                  )
                )}
              </>
            ) : (
              <p className="text-gray-500 text-sm">Status key tidak tersedia.</p>
            )}
            <p className="text-gray-600 text-xs pt-1 border-t border-line">
              Kehilangan key &amp; terkunci? Generate dari server: <span className="font-mono text-gray-400">npm run admin:setup</span>
            </p>
          </div>
        </section>

        {/* Live Prices */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-brand-400" />
              <h2 className="text-white font-semibold">Harga Market (Live)</h2>
            </div>
            <button onClick={refreshPrices} disabled={priceLoading}
              className="flex items-center gap-2 px-3 py-1.5 bg-brand-600/20 hover:bg-brand-600/30 text-brand-400 border border-brand-600/30 rounded-lg text-xs font-medium disabled:opacity-50">
              <RefreshCw className={`w-3 h-3 ${priceLoading ? 'animate-spin' : ''}`} /> Refresh dari CoinGecko
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {ASSETS.map(asset => {
              const info = prices[asset];
              const srcColor = !info ? 'text-gray-500' : info.source === 'live' ? 'text-green-400' : info.source === 'stale' ? 'text-yellow-400' : 'text-red-400';
              return (
                <div key={asset} className="bg-surface-2 border border-line rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`text-lg font-black ${ASSET_COLORS[asset]}`}>{ASSET_ICONS[asset]}</span>
                      <span className={`font-bold ${ASSET_COLORS[asset]}`}>{asset}</span>
                    </div>
                    {info && <span className={`text-xs font-medium ${srcColor}`}>{info.source} · {info.ageSeconds}s</span>}
                  </div>
                  <p className="text-white font-black text-xl">{info ? fmt(info.price) : '—'}</p>
                  <p className="text-gray-500 text-xs mt-1">per 1 {asset}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* Unified Fee Configuration */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Settings2 className="w-4 h-4 text-gray-400" />
            <h2 className="text-white font-semibold">Konfigurasi Fee</h2>
          </div>

          <div className="bg-surface-1 border border-line-subtle rounded-xl p-4 mb-4 text-xs text-gray-400 space-y-1">
            <p>Satu pengaturan berlaku untuk <strong className="text-white">semua aset</strong> (SOL, ETH, BNB) dan <strong className="text-white">semua tipe</strong> (Top Up &amp; Sell).</p>
            <p><span className="text-brand-400 font-semibold">Service Fee + Tax + Network Fee</span> = % dari gross IDR yang dipotong dari setiap transaksi.</p>
            <p><span className="text-purple-400 font-semibold">SOL ATA Fee</span> = flat IDR yang dicadangkan untuk biaya pembuatan ATA (Associated Token Account) saat Top Up SOL. Set 0 jika tidak perlu.</p>
          </div>

          {feeLoading ? (
            <div className="text-center py-8 text-gray-500 text-sm">Memuat konfigurasi...</div>
          ) : (
            <div className="bg-surface-2 border border-line rounded-xl p-6">
              {/* 3 fee rates + ATA */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <FeeInput label="Service Fee" hint={pct(fee.serviceFeeRate)} value={fee.serviceFeeRate} step="0.001"
                  onChange={v => setFee(f => ({ ...f, serviceFeeRate: v }))} />
                <FeeInput label="Tax" hint={pct(fee.taxRate)} value={fee.taxRate} step="0.001"
                  onChange={v => setFee(f => ({ ...f, taxRate: v }))} />
                <FeeInput label="Network Fee" hint={pct(fee.networkFeeRate)} value={fee.networkFeeRate} step="0.001"
                  onChange={v => setFee(f => ({ ...f, networkFeeRate: v }))} />
                <div>
                  <label className="block text-purple-400 text-xs font-medium mb-1">SOL ATA Fee (SOL)</label>
                  <input type="number" step="0.0001" min="0" max="0.01" value={fee.solAtaFeeIdr}
                    onChange={e => setFee(f => ({ ...f, solAtaFeeIdr: e.target.value }))}
                    className="w-full px-3 py-2 bg-base border border-purple-500/30 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500/60" />
                  <p className="text-gray-600 text-xs mt-0.5">
                    Flat SOL dipotong dari Top Up SOL. Contoh: 0.002 SOL untuk biaya ATA.
                  </p>
                </div>
              </div>

              {/* min/max + preview */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6 pb-6 border-b border-line">
                <FeeInput label="Min Order (IDR)" hint={fmt(fee.minOrderIdr || 0)} value={fee.minOrderIdr} step="1000"
                  onChange={v => setFee(f => ({ ...f, minOrderIdr: v }))} />
                <FeeInput label="Max Order (IDR)" hint={fmt(fee.maxOrderIdr || 0)} value={fee.maxOrderIdr} step="100000"
                  onChange={v => setFee(f => ({ ...f, maxOrderIdr: v }))} />
              </div>

              {/* Summary preview */}
              <div className="bg-base rounded-xl p-4 mb-6">
                <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">Preview — berlaku untuk semua aset</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                  {(['SOL', 'ETH', 'BNB'] as const).map(a => (
                    <div key={a} className={`p-3 rounded-lg bg-surface-2 border ${a === 'SOL' ? 'border-purple-500/20' : 'border-line'}`}>
                      <p className={`font-bold mb-1 ${ASSET_COLORS[a]}`}>{ASSET_ICONS[a]} {a}</p>
                      <p className="text-gray-500">Service: <span className="text-white">{pct(fee.serviceFeeRate)}</span></p>
                      <p className="text-gray-500">Tax: <span className="text-white">{pct(fee.taxRate)}</span></p>
                      <p className="text-gray-500">Network: <span className="text-white">{pct(fee.networkFeeRate)}</span></p>
                      {a === 'SOL' && parseFloat(fee.solAtaFeeIdr) > 0 && (
                        <p className="text-purple-400">ATA: <span className="text-white">{parseFloat(fee.solAtaFeeIdr).toFixed(4)} SOL</span></p>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <button onClick={saveFee} disabled={savingFee}
                className="flex items-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 text-white rounded-xl text-sm font-bold transition-colors">
                {savingFee
                  ? <><RefreshCw className="w-4 h-4 animate-spin" /> Menyimpan ke semua aset...</>
                  : <><Save className="w-4 h-4" /> Simpan untuk Semua Aset</>}
              </button>
            </div>
          )}
        </section>

        {/* Fee note */}
        <div className="bg-surface-1 border border-line-subtle rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
          <p className="text-gray-400 text-xs">
            Perubahan fee berlaku untuk quote baru saja. Order yang sudah dibuat menggunakan fee saat order dibuat.
            <strong className="text-purple-400"> SOL ATA Fee</strong> dipotong langsung dari jumlah SOL yang diterima user
            (bukan dari IDR). Contoh: set 0.002 untuk menutupi biaya pembuatan ATA (~0.002 SOL di mainnet).
            Set 0 jika tidak perlu.
          </p>
        </div>

      </div>
    </div>
  );
}
