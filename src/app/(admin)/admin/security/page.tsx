'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AdminNavbar } from '@/components/admin/AdminNavbar';
import { RestrictedNotice } from '@/components/admin/AdminGate';
import { formatDate } from '@/lib/format';
import { ArrowLeft, RefreshCw, ShieldAlert, Ban, CheckCircle2, Search } from 'lucide-react';
import { toast } from 'sonner';
import clsx from 'clsx';

interface SecEvent {
  id: string;
  severity: string;
  eventType: string;
  ip: string;
  subnet: string | null;
  country: string | null;
  endpoint: string | null;
  count: number;
  actionTaken: string | null;
  firstSeen: string;
  lastSeen: string;
}

interface Ban {
  ip: string;
  restrictionId: string;
  reason: string;
  level: number;
  violationCount: number;
  requestCount: number;
  duration: string;
  startedAt: string;
  expiresAt: string | null;
  remaining: string | null;
  retryAfter: number | null;
  needsReview: boolean;
  permanent: boolean;
  active: boolean;
  updatedAt: string;
}

const SEV_COLOR: Record<string, string> = {
  CRITICAL: 'text-red-400 bg-red-500/10 border-red-500/30',
  HIGH: 'text-orange-400 bg-orange-500/10 border-orange-500/30',
  MEDIUM: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
  LOW: 'text-gray-400 bg-white/5 border-white/10',
};

export default function AdminSecurityPage() {
  const router = useRouter();
  const [sessionChecked, setSessionChecked] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [restricted, setRestricted] = useState(false);
  const [events, setEvents] = useState<SecEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<{ counts24h: Record<string, number>; threatLevel: string; activeBans: number } | null>(null);
  const [bans, setBans] = useState<Ban[]>([]);
  const [loading, setLoading] = useState(true);
  const [sev, setSev] = useState('');
  const [ipFilter, setIpFilter] = useState('');
  const [banIp, setBanIp] = useState('');
  const [banReason, setBanReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (sev) params.set('severity', sev);
      if (ipFilter.trim()) params.set('ip', ipFilter.trim());
      const [er, br] = await Promise.all([
        fetch(`/api/admin/security/events?${params}`),
        fetch('/api/admin/security/bans'),
      ]);
      const ed = await er.json();
      const bd = await br.json();
      if (er.ok) {
        setEvents(ed.events ?? []);
        setTotal(ed.total ?? 0);
        setSummary(ed.summary ?? null);
      }
      if (br.ok) setBans(bd.bans ?? []);
    } catch {
      toast.error('Gagal memuat data keamanan');
    } finally {
      setLoading(false);
    }
  }, [sev, ipFilter]);

  useEffect(() => {
    fetch('/api/admin/session')
      .then((r) => r.json())
      .then((data) => {
        setSessionChecked(true);
        if (data.restricted) setRestricted(true);
        else if (data.authenticated && data.admin) {
          setAuthed(true);
          load();
        } else router.push('/admin/login');
      })
      .catch(() => router.push('/admin/login'));
  }, [router, load]);

  const doBan = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/admin/security/bans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: banIp.trim(), reason: banReason.trim() || 'Manual ban', durationMs: 60 * 60 * 1000 }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.message ?? 'Gagal');
      toast.success(`Banned ${banIp}`);
      setBanIp('');
      setBanReason('');
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal');
    }
  };

  const doUnban = async (ip: string) => {
    try {
      const res = await fetch(`/api/admin/security/bans?ip=${encodeURIComponent(ip)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Gagal');
      toast.success(`Unbanned ${ip}`);
      load();
    } catch {
      toast.error('Gagal unban');
    }
  };

  const doPatch = async (ip: string, action: 'extend' | 'reduce' | 'false-positive') => {
    try {
      const body: Record<string, unknown> = { ip, action };
      if (action === 'extend') body.durationMs = 3600000;
      if (action === 'reduce') body.violationCount = 0;
      const res = await fetch('/api/admin/security/bans', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Gagal');
      toast.success(action === 'false-positive' ? `Cleared ${ip}` : `Updated ${ip}`);
      load();
    } catch {
      toast.error('Gagal');
    }
  };

  if (restricted) return <RestrictedNotice />;
  if (!sessionChecked || !authed) return null;

  const threat = summary?.threatLevel ?? 'LOW';

  return (
    <div className="min-h-screen">
      <AdminNavbar />
      <div className="max-w-7xl mx-auto px-4 py-10">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/admin" className="text-gray-500 hover:text-white">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <ShieldAlert className="w-5 h-5 text-red-400" />
          <h1 className="text-xl font-bold text-white">Security</h1>
          <span className={clsx('ml-1 text-xs font-bold px-2.5 py-1 rounded-full border', SEV_COLOR[threat] ?? SEV_COLOR.LOW)}>
            {threat}
          </span>
          <button onClick={() => load()} className="ml-auto btn-ghost p-2" title="Refresh">
            <RefreshCw className={clsx('w-4 h-4', loading && 'animate-spin')} />
          </button>
        </div>

        {/* Summary */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
            {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((s) => (
              <div key={s} className="bg-surface-2 border border-line rounded-xl p-4">
                <p className="text-gray-500 text-xs mb-1">{s} (24h)</p>
                <p className="text-white text-2xl font-black">{summary.counts24h[s] ?? 0}</p>
              </div>
            ))}
            <div className="bg-surface-2 border border-line rounded-xl p-4">
              <p className="text-gray-500 text-xs mb-1">Active bans</p>
              <p className="text-white text-2xl font-black">{summary.activeBans}</p>
            </div>
          </div>
        )}

        {/* Events */}
        <section className="mb-10">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-white font-semibold text-sm">Security Events</h2>
            <span className="text-gray-500 text-xs">({total})</span>
            <div className="ml-auto flex gap-2">
              <select value={sev} onChange={(e) => setSev(e.target.value)} className="bg-surface-1 border border-line text-gray-300 text-xs rounded-lg px-2 py-1.5">
                <option value="">Semua severity</option>
                <option value="CRITICAL">CRITICAL</option>
                <option value="HIGH">HIGH</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="LOW">LOW</option>
              </select>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                <input value={ipFilter} onChange={(e) => setIpFilter(e.target.value)} placeholder="Filter IP…"
                  className="bg-surface-1 border border-line text-gray-300 text-xs rounded-lg pl-7 pr-2 py-1.5 w-36" />
              </div>
            </div>
          </div>
          <div className="bg-surface-2 border border-line rounded-xl overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="text-left text-gray-500 text-xs border-b border-line">
                  <th className="py-2.5 pl-4 pr-2">Severity</th>
                  <th className="py-2.5 px-2">Event</th>
                  <th className="py-2.5 px-2">IP / subnet</th>
                  <th className="py-2.5 px-2">Endpoint</th>
                  <th className="py-2.5 px-2 text-right">Count</th>
                  <th className="py-2.5 px-2">Action</th>
                  <th className="py-2.5 px-2 pr-4">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className="border-b border-line-subtle last:border-0">
                    <td className="py-2.5 pl-4 pr-2">
                      <span className={clsx('text-xs font-bold px-2 py-0.5 rounded-full border', SEV_COLOR[e.severity] ?? SEV_COLOR.LOW)}>{e.severity}</span>
                    </td>
                    <td className="py-2.5 px-2 text-gray-300 text-xs font-mono">{e.eventType}</td>
                    <td className="py-2.5 px-2 text-gray-400 text-xs font-mono">
                      {e.ip}{e.country ? <span className="text-gray-600"> · ~{e.country}</span> : null}
                      {e.subnet ? <div className="text-gray-600">{e.subnet}</div> : null}
                    </td>
                    <td className="py-2.5 px-2 text-gray-500 text-xs font-mono">{e.endpoint ?? '-'}</td>
                    <td className="py-2.5 px-2 text-right text-white font-bold">{e.count}</td>
                    <td className="py-2.5 px-2 text-gray-500 text-xs">{e.actionTaken ?? '-'}</td>
                    <td className="py-2.5 px-2 pr-4 text-gray-500 text-xs whitespace-nowrap">{formatDate(e.lastSeen)}</td>
                  </tr>
                ))}
                {events.length === 0 && !loading && (
                  <tr><td colSpan={7} className="py-8 text-center text-gray-600 text-sm">Tidak ada event.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-gray-600 text-xs mt-2">Lokasi perkiraan (~kode negara), bukan lokasi pasti.</p>
        </section>

        {/* Bans */}
        <section>
          <h2 className="text-white font-semibold text-sm mb-1">Temporary Bans</h2>
          <p className="text-gray-600 text-xs mb-3">Progressive: violation #N → N hours (capped). Never automatic-permanent.</p>
          <form onSubmit={doBan} className="flex flex-col sm:flex-row gap-2 mb-4">
            <input value={banIp} onChange={(e) => setBanIp(e.target.value)} placeholder="IP address"
              className="input-field text-sm sm:max-w-[200px]" />
            <input value={banReason} onChange={(e) => setBanReason(e.target.value)} placeholder="Alasan"
              className="input-field text-sm flex-1" />
            <button type="submit" disabled={!banIp.trim()} className="btn-primary text-sm flex items-center gap-1.5 justify-center">
              <Ban className="w-4 h-4" /> Ban 1 jam
            </button>
          </form>
          <div className="bg-surface-2 border border-line rounded-xl overflow-x-auto">
            <table className="w-full text-sm min-w-[860px]">
              <thead>
                <tr className="text-left text-gray-500 text-xs border-b border-line">
                  <th className="py-2.5 pl-4 pr-2">IP</th>
                  <th className="py-2.5 px-2">Level / violations</th>
                  <th className="py-2.5 px-2">Duration</th>
                  <th className="py-2.5 px-2">Remaining</th>
                  <th className="py-2.5 px-2">Reason</th>
                  <th className="py-2.5 px-2">Status</th>
                  <th className="py-2.5 px-2 pr-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {bans.map((b) => (
                  <tr key={b.ip} className="border-b border-line-subtle last:border-0">
                    <td className="py-2.5 pl-4 pr-2 text-white text-xs font-mono">
                      {b.ip}
                      <div className="text-gray-600">{b.restrictionId}</div>
                    </td>
                    <td className="py-2.5 px-2 text-gray-300 text-xs">
                      L{b.level} · {b.violationCount}x
                      <div className="text-gray-600">{b.requestCount} blocked hits</div>
                    </td>
                    <td className="py-2.5 px-2 text-gray-300 text-xs">{b.duration}</td>
                    <td className="py-2.5 px-2 text-yellow-400 text-xs font-mono">{b.active ? (b.remaining ?? '-') : '-'}</td>
                    <td className="py-2.5 px-2 text-gray-400 text-xs">
                      {b.reason}
                      {b.needsReview && <div className="text-red-400 font-semibold mt-0.5">Needs review (over cap)</div>}
                    </td>
                    <td className="py-2.5 px-2">
                      {b.active ? (
                        <span className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded-full">
                          {b.permanent ? 'Permanent' : 'Active'}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-500 bg-white/5 border border-white/10 px-2 py-0.5 rounded-full">Expired</span>
                      )}
                    </td>
                    <td className="py-2.5 px-2 pr-4">
                      {b.active ? (
                        <div className="flex gap-2 justify-end">
                          <button onClick={() => doPatch(b.ip, 'extend')} title="Extend +1h" className="text-xs text-yellow-400 hover:text-yellow-300">+1h</button>
                          <button onClick={() => doPatch(b.ip, 'reduce')} title="Reset level" className="text-xs text-blue-400 hover:text-blue-300">Reset</button>
                          <button onClick={() => doPatch(b.ip, 'false-positive')} title="False positive" className="text-xs text-gray-400 hover:text-gray-300">FP</button>
                          <button onClick={() => doUnban(b.ip)} className="text-xs text-green-400 hover:text-green-300 flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Unban
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => doPatch(b.ip, 'false-positive')} title="Clear history" className="text-xs text-gray-500 hover:text-gray-300 flex ml-auto">Clear</button>
                      )}
                    </td>
                  </tr>
                ))}
                {bans.length === 0 && (
                  <tr><td colSpan={7} className="py-8 text-center text-gray-600 text-sm">Tidak ada ban.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
