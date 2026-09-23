'use client';

/**
 * /admin/rewards — config + claim overview + dry-run/live payout actions
 * (existing admin session only). Live broadcast requires REWARD_PAYOUT_MODE=live.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { RefreshCw, Gift, Search } from 'lucide-react';
import { AdminNavbar } from '@/components/admin/AdminNavbar';
import { RestrictedNotice } from '@/components/admin/AdminGate';
import { shortWallet } from '@/lib/support';

interface Config {
  enabled: boolean;
  minTransactionIdr: number;
  requiredCount: number;
  rewardMinUsd: string;
  rewardMaxUsd: string;
  networks: string[];
  termsVersion: string;
}

interface Claim {
  publicId: string;
  walletAddress: string;
  cycleId: string;
  qualifyingCount: number;
  rewardUsd: string;
  network: string;
  destWallet: string;
  policyVersion: string;
  status: string;
  reviewReason: string | null;
  txHash: string | null;
  failureReason: string | null;
  attemptCount: number;
  createdAt: string;
}

interface QOrder {
  publicId: string;
  orderNumber: string;
  side: string;
  totalIdr: string;
  createdAt: string;
}

export default function AdminRewardsPage() {
  const router = useRouter();
  const [cfg, setCfg] = useState<Config | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [cycleId, setCycleId] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [restriction, setRestriction] = useState<{ remaining: string | null; retryAfter: number | null; restrictionId?: string } | null>(null);
  const [drillWallet, setDrillWallet] = useState('');
  const [drill, setDrill] = useState<{ qualifyingCount: number; eligible: boolean; qualifyingOrders: QOrder[]; claim: Claim | null } | null>(null);
  const [dryRunning, setDryRunning] = useState<string | null>(null);
  const [dryResult, setDryResult] = useState<{ claimId: string; result: { status: string; network: string; destination: string; rewardUsd: string; tokenAmount: string; baseUnits: string; rateUsd: string; transactionSubmitted: boolean } } | null>(null);

  useEffect(() => {
    fetch('/api/admin/session')
      .then((r) => r.json())
      .then((data) => {
        setSessionChecked(true);
        if (data.restricted) {
          setRestriction({
            remaining: typeof data.remaining === 'string' ? data.remaining : null,
            retryAfter: typeof data.retryAfter === 'number' ? data.retryAfter : null,
            restrictionId: typeof data.restrictionId === 'string' ? data.restrictionId : undefined,
          });
        } else if (data.authenticated && data.admin) setAuthed(true);
        else router.push('/admin/login');
      })
      .catch(() => router.push('/admin/login'));
  }, [router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/rewards', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) router.push('/admin/login');
        else toast.error(data.error?.message ?? 'Gagal memuat reward');
        return;
      }
      setCfg(data.config);
      setClaims(data.claims ?? []);
      setCycleId(data.cycle?.id ?? '');
    } catch {
      toast.error('Gagal terhubung ke server');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (authed) void load();
  }, [authed, load]);

  const save = async () => {
    if (!cfg || saving) return;
    setSaving(true);
    try {
      const res = await fetch('/api/admin/rewards', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: cfg.enabled,
          minTransactionIdr: Number(cfg.minTransactionIdr),
          requiredCount: Number(cfg.requiredCount),
          rewardMinUsd: cfg.rewardMinUsd,
          rewardMaxUsd: cfg.rewardMaxUsd,
          networks: cfg.networks,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error?.message ?? 'Gagal menyimpan config');
        return;
      }
      toast.success('Config reward tersimpan (berlaku untuk perhitungan berikutnya)');
      void load();
    } catch {
      toast.error('Gagal terhubung ke server');
    } finally {
      setSaving(false);
    }
  };

  const review = async (c: Claim, status: string) => {
    const reason = status === 'REJECTED' ? window.prompt('Alasan penolakan (opsional):') ?? undefined : undefined;
    try {
      const res = await fetch(`/api/admin/rewards/claims/${c.publicId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, ...(reason ? { reason } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error?.message ?? 'Gagal memperbarui klaim');
        return;
      }
      toast.success(`Klaim → ${status}`);
      void load();
    } catch {
      toast.error('Gagal terhubung ke server');
    }
  };

  const execute = async (c: Claim, action: 'payout' | 'reconcile') => {
    if (action === 'payout' && !window.confirm(`Broadcast LIVE payout ${c.network} ke ${c.destWallet}? Dana treasury riil akan bergerak.`)) return;
    setDryRunning(c.publicId);
    try {
      const res = await fetch(`/api/admin/rewards/claims/${c.publicId}/${action}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error?.message ?? 'Gagal.');
        return;
      }
      toast.success(action === 'payout' ? `Payout: ${(data.payout?.status ?? '')}` : `Reconcile: ${(data.reconcile?.status ?? '')}`);
      void load();
    } catch {
      toast.error('Gagal terhubung ke server.');
    } finally {
      setDryRunning(null);
    }
  };

  const dryRun = async (c: Claim) => {    setDryRunning(c.publicId);
    setDryResult(null);
    try {
      const res = await fetch(`/api/admin/rewards/claims/${c.publicId}/payout-test`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error?.message ?? 'Dry-run gagal.');
        return;
      }
      if (data.result) {
        setDryResult({ claimId: c.publicId, result: data.result });
        toast.success('Dry-run selesai — TIDAK ada dana bergerak.');
      } else {
        toast.success(`Status: ${data.state}`);
      }
      void load();
    } catch {
      toast.error('Gagal terhubung ke server.');
    } finally {
      setDryRunning(null);
    }
  };

  const drillDown = async () => {    if (!drillWallet.trim()) return;
    try {
      const res = await fetch(`/api/admin/rewards?wallet=${encodeURIComponent(drillWallet.trim())}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error?.message ?? 'Gagal memuat audit wallet');
        return;
      }
      setDrill(data);
    } catch {
      toast.error('Gagal terhubung ke server');
    }
  };

  const handleLogout = async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    window.location.href = '/admin/login';
  };

  if (restriction) {
    return (
      <RestrictedNotice
        remaining={restriction.remaining}
        retryAfter={restriction.retryAfter}
        restrictionId={restriction.restrictionId}
      />
    );
  }
  if (!sessionChecked || !authed) return null;

  return (
    <div className="min-h-screen bg-base">
      <AdminNavbar onLogout={handleLogout} />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-white text-xl font-bold flex items-center gap-2">
            <Gift className="w-5 h-5 text-brand-400" /> Rewards
            {cycleId && <span className="text-xs font-mono text-gray-500">siklus {cycleId}</span>}
          </h1>
          <button onClick={() => { void load(); }} aria-label="Muat ulang" className="p-2 text-gray-500 hover:text-white">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Config */}
        {cfg && (
          <section className="bg-surface-1 border border-line-subtle rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-white font-bold text-sm">Konfigurasi</h2>
              <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                <input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} className="accent-[#C7A048]" />
                Aktif
              </label>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div>
                <p className="label">Min/order (IDR)</p>
                <input type="number" value={cfg.minTransactionIdr} onChange={(e) => setCfg({ ...cfg, minTransactionIdr: Number(e.target.value) })} className="input-field text-sm" min={1000} />
              </div>
              <div>
                <p className="label">Syarat (tx)</p>
                <input type="number" value={cfg.requiredCount} onChange={(e) => setCfg({ ...cfg, requiredCount: Number(e.target.value) })} className="input-field text-sm" min={1} />
              </div>
              <div>
                <p className="label">Reward min (USD)</p>
                <input value={cfg.rewardMinUsd} onChange={(e) => setCfg({ ...cfg, rewardMinUsd: e.target.value })} className="input-field text-sm" inputMode="decimal" />
              </div>
              <div>
                <p className="label">Reward max (USD)</p>
                <input value={cfg.rewardMaxUsd} onChange={(e) => setCfg({ ...cfg, rewardMaxUsd: e.target.value })} className="input-field text-sm" inputMode="decimal" />
              </div>
              <div>
                <p className="label">Terms</p>
                <p className="input-field text-sm text-gray-500 font-mono">{cfg.termsVersion}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {['SOLANA', 'BNB', 'BASE'].map((n) => (
                <label key={n} className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer border border-line rounded-lg px-2.5 py-1.5">
                  <input
                    type="checkbox"
                    checked={cfg.networks.includes(n)}
                    onChange={(e) => setCfg({ ...cfg, networks: e.target.checked ? [...cfg.networks, n] : cfg.networks.filter((x) => x !== n) })}
                    className="accent-[#C7A048]"
                  />
                  {n}
                </label>
              ))}
              <button onClick={() => { void save(); }} disabled={saving} className="btn-primary text-sm px-4 py-2 disabled:opacity-50 ml-auto">
                {saving ? 'Menyimpan…' : 'Simpan Config'}
              </button>
            </div>
          </section>
        )}

        {/* Claims */}
        <section className="bg-surface-1 border border-line-subtle rounded-xl p-4">
          <h2 className="text-white font-bold text-sm mb-3">Klaim siklus berjalan ({claims.length}) — payout BELUM aktif</h2>
          {claims.length === 0 ? (
            <p className="text-gray-600 text-sm">Belum ada klaim.</p>
          ) : (
            <div className="space-y-2 max-h-[40vh] overflow-y-auto">
              {claims.map((c) => (
                <div key={c.publicId} className="border border-line-subtle rounded-xl p-3 text-xs">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <p className="text-white font-mono">{shortWallet(c.walletAddress)} · {c.qualifyingCount} tx · ${c.rewardUsd} · {c.network}</p>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-line text-gray-400">{c.status}</span>
                  </div>
                  <p className="text-gray-600 font-mono mt-1">→ {shortWallet(c.destWallet)} · {c.policyVersion} · {new Date(c.createdAt).toLocaleString('id-ID')}</p>
                  {c.txHash && <p className="text-gray-500 font-mono mt-0.5 break-all">tx: {c.txHash}</p>}
                  {c.failureReason && <p className="text-red-400/90 mt-0.5">Gagal: {c.failureReason} (percobaan {c.attemptCount})</p>}
                  {c.reviewReason && <p className="text-yellow-500/90 mt-1">Alasan: {c.reviewReason}</p>}
                  <div className="flex gap-1.5 mt-2 flex-wrap">
                    {c.status !== 'UNDER_REVIEW' && (
                      <button onClick={() => { void review(c, 'UNDER_REVIEW'); }} className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-line text-gray-400 hover:text-white">Review</button>
                    )}
                    {c.status !== 'REJECTED' && (
                      <button onClick={() => { void review(c, 'REJECTED'); }} className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-red-500/30 text-red-400 hover:bg-red-500/10">Reject</button>
                    )}
                    {(c.status === 'UNDER_REVIEW' || c.status === 'REJECTED') && (
                      <button onClick={() => { void review(c, 'PENDING_PAYOUT'); }} className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-line text-gray-400 hover:text-white">Kembalikan pending</button>
                    )}
                    {(c.status === 'PENDING_PAYOUT' || c.status === 'DRY_RUN' || c.status === 'FAILED') && (
                      <button
                        onClick={() => { void dryRun(c); }}
                        disabled={dryRunning === c.publicId}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-brand-500/40 text-brand-400 hover:bg-brand-600/10 disabled:opacity-50"
                      >
                        {dryRunning === c.publicId ? 'Dry-run…' : 'Test Payout (Dry Run)'}
                      </button>
                    )}
                    {(c.status === 'PENDING_PAYOUT' || c.status === 'FAILED') && (
                      <button
                        onClick={() => { void execute(c, 'payout'); }}
                        disabled={dryRunning === c.publicId}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-red-500/40 text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                        title="LIVE broadcast — requires REWARD_PAYOUT_MODE=live"
                      >
                        Payout (Live)
                      </button>
                    )}
                    {(c.status === 'FAILED' || c.status === 'SUBMITTED' || c.status === 'CONFIRMING') && c.txHash && (
                      <button
                        onClick={() => { void execute(c, 'reconcile'); }}
                        disabled={dryRunning === c.publicId}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-line text-gray-400 hover:text-white disabled:opacity-50"
                      >
                        Reconcile Payout
                      </button>
                    )}
                  </div>
                  {dryResult && dryResult.claimId === c.publicId && (
                    <div className="mt-2 bg-base border border-line-subtle rounded-lg p-2.5 font-mono text-gray-400">
                      <p>status: {dryResult.result.status} · broadcast: {String(dryResult.result.transactionSubmitted)}</p>
                      <p>{dryResult.result.tokenAmount} (≈${dryResult.result.rewardUsd} @ ${dryResult.result.rateUsd})</p>
                      <p className="break-all">baseUnits: {dryResult.result.baseUnits}</p>
                      <p className="break-all">→ {dryResult.result.destination}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Drill-down */}
        <section className="bg-surface-1 border border-line-subtle rounded-xl p-4">
          <h2 className="text-white font-bold text-sm mb-3">Audit wallet (order penyumbang progress)</h2>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" />
              <input value={drillWallet} onChange={(e) => setDrillWallet(e.target.value)} placeholder="Alamat wallet…" className="input-field text-sm pl-9 font-mono" />
            </div>
            <button onClick={() => { void drillDown(); }} className="btn-secondary text-sm px-4">Audit</button>
          </div>
          {drill && (
            <div className="mt-3 text-xs">
              <p className="text-gray-400">{drill.qualifyingCount} qualifying · {drill.eligible ? 'eligible' : 'belum eligible'}{drill.claim ? ` · klaim ${drill.claim.status}` : ''}</p>
              <div className="mt-2 space-y-1 max-h-[30vh] overflow-y-auto font-mono text-gray-500">
                {drill.qualifyingOrders.map((o) => (
                  <p key={o.publicId}>{o.side} · {o.orderNumber} · Rp{o.totalIdr} · {new Date(o.createdAt).toLocaleDateString('id-ID')}</p>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
