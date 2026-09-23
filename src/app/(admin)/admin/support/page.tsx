'use client';

/**
 * /admin/support — support inbox (native part of Admin Dashboard).
 * Left: searchable/filterable ticket list. Right: threaded conversation.
 * Auth: existing admin session (AdminGate pattern). No mock data.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import clsx from 'clsx';
import { RefreshCw, Search, Send, ArrowLeft, LifeBuoy } from 'lucide-react';
import { AdminNavbar } from '@/components/admin/AdminNavbar';
import { RestrictedNotice } from '@/components/admin/AdminGate';
import { shortWallet } from '@/lib/support';

interface Message {
  id: string;
  senderType: string;
  message: string;
  createdAt: string;
}

interface Ticket {
  id: string;
  publicId: string;
  subject: string;
  message: string;
  walletAddress: string;
  walletType: string;
  orderPublicId: string | null;
  orderSide: string | null;
  orderStatus: string | null;
  txHash: string | null;
  status: string;
  adminUnread: number;
  customerUnread: number;
  lastMessageAt: string | null;
  createdAt: string;
  messages?: Message[];
}

const FILTERS = ['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED', 'ALL'] as const;

function statusStyle(s: string): string {
  if (s === 'OPEN') return 'bg-red-500/10 text-red-400 border-red-500/25';
  if (s === 'IN_PROGRESS') return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/25';
  if (s === 'WAITING_CUSTOMER') return 'bg-blue-500/10 text-blue-400 border-blue-500/25';
  return 'bg-green-500/10 text-green-400 border-green-500/25';
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export default function AdminSupportPage() {
  const router = useRouter();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [filter, setFilter] = useState<string>('OPEN');
  const [query, setQuery] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [ticketDetail, setTicketDetail] = useState<Ticket | null>(null);
  const [convLoading, setConvLoading] = useState(false);
  const [convError, setConvError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [restriction, setRestriction] = useState<{ remaining: string | null; retryAfter: number | null; restrictionId?: string } | null>(null);
  const pollRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);

  // Session gate — same pattern as other admin pages.
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
      const params = new URLSearchParams({ take: '50' });
      if (filter && filter !== 'ALL') params.set('status', filter);
      if (debouncedQ) params.set('q', debouncedQ);
      const res = await fetch(`/api/admin/support?${params}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) router.push('/admin/login');
        else toast.error(data.error?.message ?? 'Gagal memuat tiket');
        setTickets([]);
        return;
      }
      setTickets(data.tickets ?? []);
      if (typeof data.pendingCount === 'number') setPendingCount(data.pendingCount);
    } catch {
      toast.error('Gagal terhubung ke server');
    } finally {
      setLoading(false);
    }
  }, [filter, debouncedQ, router]);

  useEffect(() => {
    if (authed) void load();
  }, [authed, load]);

  const openTicket = useCallback(async (id: string) => {
    setSelectedId(id);
    setConvLoading(true);
    setConvError(null);
    try {
      const res = await fetch(`/api/admin/support/${id}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) {
        setConvError(data.error?.message ?? 'Gagal memuat percakapan.');
        return;
      }
      const t: Ticket = data.ticket;
      setTicketDetail(t);
      setMessages((t as Ticket & { messages?: Message[] }).messages ?? []);
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block: 'end' }));
      void load();
    } catch {
      setConvError('Gagal terhubung ke server.');
    } finally {
      setConvLoading(false);
    }
  }, [load]);

  // Lightweight polling (4s) while a conversation is open and tab visible.
  useEffect(() => {
    if (!selectedId || !authed) return;
    const tick = async () => {
      if (pollRef.current || document.hidden) return;
      pollRef.current = true;
      try {
        const last = messages.length > 0 ? messages[messages.length - 1].createdAt : null;
        const params = new URLSearchParams({ take: '100' });
        if (last) params.set('after', last);
        const res = await fetch(`/api/admin/support/${selectedId}/messages?${params}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data.messages) && data.messages.length > 0) {
          setMessages((prev) => [...prev, ...data.messages]);
          requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block: 'end' }));
          void load();
        }
        if (data.status && ticketDetail && data.status !== ticketDetail.status) {
          setTicketDetail({ ...ticketDetail, status: data.status });
        }
      } catch {}
      finally { pollRef.current = false; }
    };
    const t = setInterval(() => { void tick(); }, 4000);
    return () => clearInterval(t);
  }, [selectedId, authed, messages, ticketDetail, load]);

  const send = async () => {
    const text = draft.trim();
    if (!text || !selectedId || sending) return;
    if (text.length > 4000) {
      toast.error('Pesan maksimal 4000 karakter.');
      return;
    }
    setSending(true);
    try {
      const res = await fetch(`/api/admin/support/${selectedId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error?.message ?? 'Gagal mengirim balasan.');
        return;
      }
      setMessages((prev) => [...prev, data.message]);
      setDraft('');
      if (ticketDetail?.status === 'OPEN') setTicketDetail({ ...ticketDetail, status: 'IN_PROGRESS' });
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block: 'end' }));
      void load();
    } catch {
      toast.error('Gagal terhubung ke server.');
    } finally {
      setSending(false);
    }
  };

  const changeStatus = async (status: string) => {
    if (!selectedId || updating) return;
    setUpdating(true);
    try {
      const res = await fetch(`/api/admin/support/${selectedId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error?.message ?? 'Gagal memperbarui status.');
        return;
      }
      toast.success(`Tiket → ${status.replace('_', ' ')}`);
      setTicketDetail((prev) => (prev ? { ...prev, status } : prev));
      void load();
    } catch {
      toast.error('Gagal terhubung ke server.');
    } finally {
      setUpdating(false);
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

  const selected = ticketDetail && ticketDetail.id === selectedId ? ticketDetail : null;

  return (
    <div className="min-h-screen bg-base">
      <AdminNavbar onLogout={handleLogout} />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-white text-xl font-bold flex items-center gap-2">
            <LifeBuoy className="w-5 h-5 text-brand-400" /> Support
            {pendingCount > 0 && (
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/25">
                {pendingCount} perlu perhatian
              </span>
            )}
          </h1>
          <button onClick={() => { void load(); }} aria-label="Muat ulang" className="p-2 text-gray-500 hover:text-white">
            <RefreshCw className={clsx('w-4 h-4', loading && 'animate-spin')} />
          </button>
        </div>

        <div className="grid md:grid-cols-[320px_1fr] gap-4">
          {/* LEFT: list */}
          <div className={clsx('space-y-3', selectedId && 'hidden md:block')}>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cari ID, wallet, order, subjek…"
                className="input-field text-sm pl-9"
                maxLength={100}
              />
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {FILTERS.map((s) => (
                <button
                  key={s}
                  onClick={() => setFilter(s === 'ALL' ? 'ALL' : s)}
                  className={clsx(
                    'px-2.5 py-1 rounded-lg text-[11px] font-semibold border',
                    filter === s
                      ? 'border-brand-500/50 text-brand-400 bg-brand-600/10'
                      : 'border-line text-gray-500 hover:text-white',
                  )}
                >
                  {s.replace('_', ' ')}
                </button>
              ))}
            </div>
            {tickets.length === 0 && !loading && (
              <p className="text-gray-600 text-sm border border-line-subtle rounded-xl p-4">No support conversations yet.</p>
            )}
            <div className="space-y-2 max-h-[65vh] overflow-y-auto pr-0.5">
              {tickets.map((t) => {
                const last = t.messages?.[0];
                const active = t.id === selectedId;
                return (
                  <button
                    key={t.id}
                    onClick={() => { void openTicket(t.id); }}
                    className={clsx(
                      'w-full text-left bg-surface-1 border rounded-xl p-3 hover:border-line-strong transition-colors',
                      active ? 'border-brand-500/50' : 'border-line-subtle',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-white font-semibold text-[13px] leading-snug line-clamp-1">{t.subject}</p>
                      {t.adminUnread > 0 && (
                        <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                          {t.adminUnread > 99 ? '99+' : t.adminUnread}
                        </span>
                      )}
                    </div>
                    <p className="text-gray-500 text-[11px] font-mono mt-1">
                      {t.publicId.slice(0, 8)}… · {shortWallet(t.walletAddress)} · {fmtTime(t.lastMessageAt ?? t.createdAt)}
                    </p>
                    {last && (
                      <p className="text-gray-400 text-xs mt-1 line-clamp-1">
                        <span className="text-gray-600">{last.senderType === 'ADMIN' ? 'Admin: ' : ''}</span>
                        {last.message}
                      </p>
                    )}
                    <span className={clsx('inline-block mt-2 text-[10px] font-bold px-2 py-0.5 rounded-full border', statusStyle(t.status))}>
                      {t.status.replace('_', ' ')}
                    </span>
                  </button>
                );
              })}
              {loading && [0, 1, 2].map((i) => (
                <div key={i} className="bg-surface-1 border border-line-subtle rounded-xl p-3 animate-pulse">
                  <div className="h-4 w-2/3 bg-line rounded mb-2" />
                  <div className="h-3 w-1/2 bg-line rounded" />
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT: conversation */}
          <div className={clsx('bg-surface-1 border border-line-subtle rounded-xl flex flex-col min-h-[60vh] max-h-[75vh]', !selectedId && 'hidden md:flex')}>
            {!selectedId ? (
              <div className="flex-1 flex items-center justify-center p-8">
                <p className="text-gray-600 text-sm">Pilih tiket untuk membaca percakapan.</p>
              </div>
            ) : convLoading ? (
              <div className="flex-1 p-4 space-y-3 animate-pulse">
                <div className="h-4 w-1/3 bg-line rounded" />
                <div className="h-16 bg-line rounded-xl" />
                <div className="h-16 bg-line rounded-xl ml-12" />
              </div>
            ) : convError ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8">
                <p className="text-red-400 text-sm">Failed to load conversation.</p>
                <button onClick={() => selectedId && openTicket(selectedId)} className="btn-secondary text-sm px-4 py-2">Coba lagi</button>
                <button onClick={() => setSelectedId(null)} className="text-gray-500 text-xs md:hidden">← Kembali ke daftar</button>
              </div>
            ) : selected ? (
              <>
                <div className="border-b border-line-subtle p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <button onClick={() => setSelectedId(null)} className="md:hidden p-1.5 text-gray-400 hover:text-white" aria-label="Kembali">
                      <ArrowLeft className="w-4 h-4" />
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="text-white font-bold text-sm leading-snug">{selected.subject}</p>
                      <p className="text-gray-500 text-[11px] font-mono">
                        {selected.publicId.slice(0, 8)}… · {shortWallet(selected.walletAddress)} · {selected.walletType}
                      </p>
                    </div>
                    <span className={clsx('text-[10px] font-bold px-2 py-0.5 rounded-full border whitespace-nowrap', statusStyle(selected.status))}>
                      {selected.status.replace('_', ' ')}
                    </span>
                  </div>
                  {(selected.orderPublicId || selected.txHash) && (
                    <div className="text-[11px] text-gray-500 font-mono bg-base border border-line-subtle rounded-lg px-3 py-2">
                      {selected.orderPublicId && (
                        <p>
                          Order: {selected.orderSide} · {selected.orderPublicId} · {selected.orderStatus ?? '-'}
                          {' '}<a href={`/order/${selected.orderPublicId}`} target="_blank" rel="noreferrer" className="text-brand-400 underline">tracking →</a>
                        </p>
                      )}
                      {selected.txHash && <p className="break-all">TX: {selected.txHash}</p>}
                    </div>
                  )}
                  <div className="flex gap-1.5 flex-wrap">
                    {(['IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED'] as const)
                      .filter((s) => s !== selected.status)
                      .map((s) => (
                        <button
                          key={s}
                          disabled={updating}
                          onClick={() => { void changeStatus(s); }}
                          className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-line text-gray-400 hover:text-white hover:border-line-strong disabled:opacity-50"
                        >
                          → {s.replace('_', ' ')}
                        </button>
                      ))}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {messages.length === 0 && (
                    <p className="text-gray-600 text-sm text-center">No messages yet.</p>
                  )}
                  {messages.map((m) => {
                    const mine = m.senderType === 'ADMIN';
                    return (
                      <div key={m.id} className={clsx('flex', mine ? 'justify-end' : 'justify-start')}>
                        <div className={clsx(
                          'max-w-[80%] rounded-2xl px-3.5 py-2.5',
                          mine
                            ? 'bg-brand-600/20 border border-brand-500/30 rounded-br-md'
                            : 'bg-surface-2 border border-line rounded-bl-md',
                        )}>
                          <p className={clsx('text-[10px] font-bold mb-1', mine ? 'text-brand-400 text-right' : 'text-gray-500')}>
                            {mine ? 'ADMIN' : 'CUSTOMER'}
                          </p>
                          <p className="text-gray-100 text-sm whitespace-pre-wrap break-words">{m.message}</p>
                          <p className={clsx('text-[10px] text-gray-600 mt-1', mine && 'text-right')}>{fmtTime(m.createdAt)}</p>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={bottomRef} />
                </div>

                <div className="border-t border-line-subtle p-3">
                  <div className="flex gap-2">
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          void send();
                        }
                      }}
                      placeholder="Tulis balasan… (Enter kirim, Shift+Enter baris baru)"
                      className="input-field text-sm min-h-[44px] max-h-32 flex-1"
                      maxLength={4000}
                      disabled={sending}
                    />
                    <button
                      onClick={() => { void send(); }}
                      disabled={!draft.trim() || sending}
                      className="btn-primary px-4 flex items-center gap-1.5 disabled:opacity-50"
                      aria-label="Kirim balasan"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
