'use client';

/**
 * SupportModal — report a problem + continue the conversation with admin.
 * Wallet-first: wallet address IS the identity (no login).
 * Views: list (My Support Tickets) → new ticket → conversation (polling).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, LifeBuoy, ArrowLeft, Plus, Send } from 'lucide-react';
import { toast } from 'sonner';
import clsx from 'clsx';
import type { WalletOrderItem } from '@/app/api/wallets/[address]/orders/route';
import { getWalletToken, clearWalletToken } from '@/lib/useWalletAuth';
import { useSignMessage } from 'wagmi';
import { useWallet as useSolanaWallet } from '@solana/wallet-adapter-react';

interface Props {
  open: boolean;
  onClose: () => void;
  walletAddress: string | null;
  walletType: 'EVM' | 'SOLANA' | null;
  recentOrders: WalletOrderItem[];
  onSubmitted?: () => void;
}

interface TicketSummary {
  publicId: string;
  subject: string;
  status: string;
  orderPublicId: string | null;
  orderSide: string | null;
  customerUnread: number;
  lastMessageAt: string | null;
  createdAt: string;
  messages?: { message: string; senderType: string; createdAt: string }[];
}

interface ChatMessage {
  id: string;
  senderType: string;
  message: string;
  createdAt: string;
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function SupportModal({ open, onClose, walletAddress, walletType, recentOrders, onSubmitted }: Props) {
  const [view, setView] = useState<'list' | 'new' | string>('list');
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [orderPublicId, setOrderPublicId] = useState('');
  const [sending, setSending] = useState(false);
  const [triedSubmit, setTriedSubmit] = useState(false);
  const { signMessageAsync } = useSignMessage();
  const { signMessage: signSol } = useSolanaWallet();

  // Signer bound to the connected wallet type. Throws a user-readable error
  // when the wallet cannot sign (message shown in toast by callers).
  const signForSupport = async (message: string): Promise<string> => {
    if (walletType === 'EVM') return signMessageAsync({ message });
    if (!signSol) throw new Error('Wallet Solana tidak mendukung tanda tangan.');
    const sig = await signSol(new TextEncoder().encode(message));
    return Array.from(sig).map((b) => b.toString(16).padStart(2, '0')).join('');
  };

  // POST with proven-identity header; single retry after clearing a rejected session.
  const authedSupportPost = async (url: string, body: unknown): Promise<Response> => {
    if (!walletAddress || !walletType) throw new Error('Hubungkan wallet terlebih dahulu.');
    const once = async () => {
      const token = await getWalletToken({ walletAddress, ecosystem: walletType, purpose: 'SUPPORT', sign: signForSupport });
      return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-wallet-auth': `Bearer ${token}` },
        body: JSON.stringify(body),
      });
    };
    const first = await once();
    if (first.status !== 401) return first;
    clearWalletToken(walletAddress, 'SUPPORT');
    return once();
  };
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [chatMeta, setChatMeta] = useState<{ subject: string; status: string; orderPublicId: string | null } | null>(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const pollRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const canSend =
    subject.trim().length >= 3 &&
    message.trim().length >= 10 &&
    !!walletAddress &&
    !!walletType &&
    orderPublicId !== '' &&
    !sending;

  const loadList = useCallback(async () => {
    if (!walletAddress) return;
    setListLoading(true);
    try {
      const res = await fetch(`/api/support?wallet=${encodeURIComponent(walletAddress)}`, { cache: 'no-store' });
      const data = await res.json();
      if (res.ok) setTickets(data.tickets ?? []);
    } catch {}
    finally { setListLoading(false); }
  }, [walletAddress]);

  useEffect(() => {
    if (open) {
      setView('list');
      setDraft('');
      setChat([]);
      void loadList();
    }
  }, [open, loadList]);

  const openChat = useCallback(async (publicId: string) => {
    if (!walletAddress) return;
    setView(publicId);
    setChatLoading(true);
    try {
      const res = await fetch(`/api/support/${publicId}?wallet=${encodeURIComponent(walletAddress)}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error?.message ?? 'Gagal membuka percakapan');
        setView('list');
        return;
      }
      setChat(data.ticket.messages ?? []);
      setChatMeta({ subject: data.ticket.subject, status: data.ticket.status, orderPublicId: data.ticket.orderPublicId });
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block: 'end' }));
      void loadList();
    } catch {
      toast.error('Gagal terhubung ke server');
      setView('list');
    } finally {
      setChatLoading(false);
    }
  }, [walletAddress, loadList]);

  // Polling while a conversation is open (4s, tab-visible only, no overlap).
  useEffect(() => {
    if (!open || view === 'list' || view === 'new' || !walletAddress) return;
    const publicId = view;
    const tick = async () => {
      if (pollRef.current || document.hidden) return;
      pollRef.current = true;
      try {
        const res = await fetch(`/api/support/${publicId}?wallet=${encodeURIComponent(walletAddress)}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        const msgs: ChatMessage[] = data.ticket.messages ?? [];
        setChat((prev) => (msgs.length !== prev.length ? msgs : prev));
        setChatMeta({ subject: data.ticket.subject, status: data.ticket.status, orderPublicId: data.ticket.orderPublicId });
      } catch {}
      finally { pollRef.current = false; }
    };
    const t = setInterval(() => { void tick(); }, 4000);
    return () => clearInterval(t);
  }, [open, view, walletAddress]);

  const submit = async () => {
    if (!canSend) {
      setTriedSubmit(true);
      return;
    }
    setSending(true);
    try {
      const res = await authedSupportPost('/api/support', {
        subject: subject.trim(),
        message: message.trim(),
        walletAddress,
        walletType,
        orderPublicId,
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error?.message ?? 'Gagal mengirim permintaan support');
        return;
      }
      toast.success('Terkirim! Admin akan membalas di sini.');
      setSubject('');
      setMessage('');
      setOrderPublicId('');
      setTriedSubmit(false);
      onSubmitted?.();
      await loadList();
      await openChat(data.ticket.publicId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal terhubung ke server');
    } finally {
      setSending(false);
    }
  };

  const sendChat = async () => {
    const text = draft.trim();
    if (!text || !walletAddress || view === 'list' || view === 'new' || chatSending) return;
    if (text.length > 4000) {
      toast.error('Pesan maksimal 4000 karakter.');
      return;
    }
    setChatSending(true);
    try {
      const res = await authedSupportPost(`/api/support/${view}/messages`, {
        message: text,
        walletAddress,
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error?.message ?? 'Unable to send message. Please try again.');
        return;
      }
      setChat((prev) => [...prev, data.message]);
      setDraft('');
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block: 'end' }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Unable to send message. Please try again.');
    } finally {
      setChatSending(false);
    }
  };

  const inChat = view !== 'list' && view !== 'new';

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/70 p-4"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label="Hubungi support KORAMP"
        >
          <motion.div
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="w-full max-w-md bg-surface-1 border border-line rounded-2xl p-5 space-y-4 max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2">
                {inChat ? (
                  <button onClick={() => setView('list')} className="p-1.5 text-gray-400 hover:text-white" aria-label="Kembali">
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                ) : (
                  <LifeBuoy className="w-5 h-5 text-brand-400" />
                )}
                <h3 className="text-white font-bold">
                  {view === 'list' ? 'Support' : view === 'new' ? 'Tiket Baru' : (chatMeta?.subject ?? 'Percakapan')}
                </h3>
              </div>
              <button onClick={onClose} aria-label="Tutup" className="p-2 text-gray-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            {view === 'list' && (
              <div className="space-y-3 overflow-y-auto">
                <button onClick={() => setView('new')} className="btn-primary w-full text-sm">
                  <Plus className="w-4 h-4 inline mr-1.5" /> New Support Request
                </button>
                {listLoading ? (
                  <div className="space-y-2 animate-pulse">
                    <div className="h-14 bg-line rounded-xl" />
                    <div className="h-14 bg-line rounded-xl" />
                  </div>
                ) : tickets.length === 0 ? (
                  <p className="text-gray-600 text-sm text-center py-4">You don&apos;t have any support tickets.</p>
                ) : (
                  <>
                    <p className="text-gray-500 text-xs uppercase tracking-widest">Open Tickets</p>
                    {tickets.map((t) => (
                      <button
                        key={t.publicId}
                        onClick={() => { void openChat(t.publicId); }}
                        className="w-full text-left bg-surface-2 border border-line-subtle rounded-xl p-3 hover:border-line-strong"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-white text-sm font-semibold line-clamp-1">{t.subject}</p>
                          {t.customerUnread > 0 && (
                            <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-brand-500 text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                              {t.customerUnread}
                            </span>
                          )}
                        </div>
                        <p className="text-gray-500 text-[11px] font-mono mt-0.5">
                          {t.publicId.slice(0, 8)}… · {t.status.replace('_', ' ')} · {fmtTime(t.lastMessageAt ?? t.createdAt)}
                        </p>
                        {t.messages?.[0] && (
                          <p className="text-gray-400 text-xs mt-1 line-clamp-1">{t.messages[0].message}</p>
                        )}
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}

            {view === 'new' && (
              <div className="space-y-4 overflow-y-auto">
                <div>
                  <label className="label" htmlFor="support-subject">Subjek</label>
                  <input
                    id="support-subject"
                    className="input-field text-sm"
                    placeholder="Contoh: Pembayaran belum diterima"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    maxLength={200}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="support-message">Pesan</label>
                  <textarea
                    id="support-message"
                    className="input-field text-sm min-h-[110px]"
                    placeholder="Ceritakan kendala Anda… (konteks wallet & order dilampirkan otomatis)"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    maxLength={5000}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="support-order">
                    Transaksi bermasalah <span className="text-red-400">*</span>
                  </label>
                  {recentOrders.length === 0 ? (
                    <div className="input-field text-sm text-gray-500" role="status">
                      Belum ada transaksi yang dapat dilaporkan.
                    </div>
                  ) : (
                    <select
                      id="support-order"
                      className="input-field text-sm"
                      value={orderPublicId}
                      onChange={(e) => setOrderPublicId(e.target.value)}
                      required
                      aria-required="true"
                    >
                      <option value="" disabled>
                        Pilih transaksi yang ingin dilaporkan…
                      </option>
                      {recentOrders.slice(0, 20).map((o) => {
                        const pair = o.side === 'TOP_UP' ? `IDR → ${o.assetSymbol}` : `${o.assetSymbol} → IDR`;
                        let date = '';
                        try {
                          date = new Date(o.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
                        } catch {
                          date = '';
                        }
                        return (
                          <option key={o.publicId} value={o.publicId}>
                            {o.side === 'TOP_UP' ? 'BUY' : 'SELL'} · {pair} · {o.orderNumber} · {o.status.replace(/_/g, ' ')}{date ? ` · ${date}` : ''}
                          </option>
                        );
                      })}
                    </select>
                  )}
                  {triedSubmit && !orderPublicId && recentOrders.length > 0 && (
                    <p className="text-red-400 text-xs mt-1.5" role="alert">
                      Pilih transaksi yang ingin dilaporkan.
                    </p>
                  )}
                  <p className="text-gray-600 text-xs mt-1.5">
                    Wallet {walletAddress ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}` : '—'} dilampirkan otomatis.
                  </p>
                </div>
                <button onClick={submit} disabled={!canSend} className="btn-primary w-full">
                  {sending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                      Mengirim…
                    </>
                  ) : (
                    'Kirim Permintaan Support'
                  )}
                </button>
              </div>
            )}

            {inChat && (
              <div className="flex flex-col min-h-0 flex-1">
                {chatMeta && (
                  <div className="text-[11px] text-gray-500 font-mono bg-base border border-line-subtle rounded-lg px-3 py-2 mb-3 flex-shrink-0">
                    Status: <span className="text-brand-400">{chatMeta.status.replace('_', ' ')}</span>
                    {chatMeta.orderPublicId && <span> · Order: {chatMeta.orderPublicId.slice(0, 12)}…</span>}
                  </div>
                )}
                <div className="flex-1 overflow-y-auto space-y-2.5 min-h-[200px] pr-0.5">
                  {chatLoading ? (
                    <div className="space-y-2 animate-pulse">
                      <div className="h-12 bg-line rounded-xl" />
                      <div className="h-12 bg-line rounded-xl ml-8" />
                    </div>
                  ) : chat.length === 0 ? (
                    <p className="text-gray-600 text-sm text-center">No messages yet.</p>
                  ) : (
                    chat.map((m) => {
                      const mine = m.senderType === 'CUSTOMER';
                      return (
                        <div key={m.id} className={clsx('flex', mine ? 'justify-end' : 'justify-start')}>
                          <div className={clsx(
                            'max-w-[85%] rounded-2xl px-3 py-2',
                            mine
                              ? 'bg-brand-600/20 border border-brand-500/30 rounded-br-md'
                              : 'bg-surface-2 border border-line rounded-bl-md',
                          )}>
                            <p className="text-gray-100 text-sm whitespace-pre-wrap break-words">{m.message}</p>
                            <p className={clsx('text-[10px] text-gray-600 mt-1', mine && 'text-right')}>{fmtTime(m.createdAt)}</p>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={bottomRef} />
                </div>
                <div className="flex gap-2 mt-3 flex-shrink-0">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void sendChat();
                      }
                    }}
                    placeholder="Tulis pesan… (Enter kirim)"
                    className="input-field text-sm min-h-[44px] max-h-28 flex-1"
                    maxLength={4000}
                    disabled={chatSending}
                  />
                  <button
                    onClick={() => { void sendChat(); }}
                    disabled={!draft.trim() || chatSending}
                    className="btn-primary px-3.5 disabled:opacity-50"
                    aria-label="Kirim pesan"
                  >
                    {chatSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
