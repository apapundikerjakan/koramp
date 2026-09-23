'use client';

/**
 * WalletSidebar — premium right-side account drawer.
 *
 * Overlay only: never navigates away from the current page (the single
 * exception is "View" on a transaction, which goes to the canonical
 * /order/[publicId] tracking page — same rule as "Lacak Order").
 *
 * Data-source separation (explicit by section):
 * - CONNECTED WALLETS … walletStore associations + live provider state
 * - BALANCE ………………… blockchain RPC (wagmi / Solana connection), never DB
 * - WALLET ACTIVITY …… explorer links (blockchain is source of truth)
 * - ACTIVE / HISTORY … KORAMP order APIs (application source of truth)
 * - SUPPORT ……………… KORAMP support API + admin dashboard
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useBalance, useChainId } from 'wagmi';
import { useConnection as useSolanaConnection } from '@solana/wallet-adapter-react';
import { useWalletModal as useSolanaWalletModal } from '@solana/wallet-adapter-react-ui';
import { PublicKey } from '@solana/web3.js';
import { useWallet } from '@/contexts/WalletContext';
import { getTxExplorerUrl } from '@/lib/assets';
import {
  loadAssociations, rememberWallet, forgetWallet,
  setPreferredAddress, shortAddress,
  type AssociatedWallet, type AssociatedEcosystem,
} from '@/lib/walletStore';
import { useWalletSelection } from '@/lib/useWalletSelection';
import { SupportModal } from './SupportModal';
import { RewardPanel } from './RewardPanel';
import type { WalletOrderItem } from '@/app/api/wallets/[address]/orders/route';
import {
  X, Plus, Unlink, LifeBuoy, ExternalLink,
  ArrowDownLeft, ArrowUpRight, RefreshCw, Menu,
} from 'lucide-react';
import { toast } from 'sonner';
import clsx from 'clsx';

interface Props {
  open: boolean;
  onClose: () => void;
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

export function WalletSidebarButton() {
  const { isConnected, openEvmModal } = useWallet();
  const { setVisible: setSolVisible } = useSolanaWalletModal();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chooseOpen, setChooseOpen] = useState(false);
  // Portal target exists only on the client (SSR-safe).
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    setMounted(true);
  }, []);

  const closeChoose = useCallback(() => setChooseOpen(false), []);

  // Viewport scroll-lock + ESC + focus management while the chooser is open.
  // Overflow behavior and scrollbar compensation are restored on close, and
  // focus returns to the trigger (same pattern as the wallet drawer below).
  useEffect(() => {
    if (!chooseOpen) return;
    const prevOverflow = document.body.style.overflow;
    const prevPadding = document.body.style.paddingRight;
    const sw = window.innerWidth - document.documentElement.clientWidth;
    if (sw > 0) document.body.style.paddingRight = `${sw}px`;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    const trigger = triggerRef.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeChoose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPadding;
      trigger?.focus();
    };
  }, [chooseOpen, closeChoose]);

  if (!isConnected) {
    return (
      <>
        <button
          type="button"
          ref={triggerRef}
          onClick={() => setChooseOpen(true)}
          className="h-10 px-4 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold transition-colors flex-shrink-0"
        >
          Connect Wallet
        </button>
        {mounted &&
          createPortal(
            <AnimatePresence>
              {chooseOpen && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 overflow-y-auto"
                  onClick={closeChoose}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="wallet-choose-title"
                >
                  <motion.div
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.96 }}
                    transition={{ duration: 0.15, ease: 'easeOut' }}
                    ref={dialogRef}
                    tabIndex={-1}
                    role="document"
                    className="w-full max-w-xs bg-surface-1 border border-line rounded-2xl p-5 space-y-3 my-auto max-h-[90vh] overflow-y-auto outline-none"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <p id="wallet-choose-title" className="text-white font-bold text-sm">Hubungkan wallet</p>
                    <button
                      onClick={() => { closeChoose(); openEvmModal(); }}
                      className="btn-secondary w-full text-sm"
                    >
                      EVM Wallet
                    </button>
                    <button
                      onClick={() => { closeChoose(); setSolVisible(true); }}
                      className="btn-secondary w-full text-sm"
                    >
                      Solana Wallet
                    </button>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>,
            document.body,
          )}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setSidebarOpen(true)}
        aria-label="Buka menu wallet"
        className="h-10 w-10 rounded-xl bg-surface-2 border border-line hover:border-line-strong text-white flex items-center justify-center transition-colors flex-shrink-0"
      >
        <Menu className="w-5 h-5" />
      </button>
      <WalletSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
    </>
  );
}

/** Terminal order status: polling ticks skip when all orders are terminal. */
function isTerminalOrderStatus(s: string): boolean {
  return (
    s === 'COMPLETED' ||
    s === 'FAILED' ||
    s.endsWith('_FAILED') ||
    s === 'EXPIRED' ||
    s === 'CANCELLED' ||
    s === 'REFUNDED'
  );
}

export function WalletSidebar({ open, onClose }: Props) {
  const router = useRouter();
  const {
    evmConnected, evmAddress, evmWalletName,
    solConnected, solAddress, solWalletName,
    openEvmModal, disconnectEvm, disconnectSol,
  } = useWallet();
  const { setVisible: setSolVisible } = useSolanaWalletModal();
  const { connection } = useSolanaConnection();
  const evmChainId = useChainId();

  const [ordersByWallet, setOrdersByWallet] = useState<Record<string, WalletOrderItem[]>>({});
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportUnread, setSupportUnread] = useState(0);
  const [panelTab, setPanelTab] = useState<'wallet' | 'reward'>('wallet');
  const [addingEcosystem, setAddingEcosystem] = useState<AssociatedEcosystem | null>(null);
  const [solBalance, setSolBalance] = useState<string | null>(null);

  const liveEvm = evmConnected && evmAddress ? evmAddress : null;
  const liveSol = solConnected && solAddress ? solAddress : null;

  // Per-ecosystem deterministic selection (single-wallet auto, multi manual).
  const { associations, evm: evmSel, sol: solSel, refresh: refreshWallets } = useWalletSelection(liveEvm, liveSol);

  const { data: evmBalance } = useBalance({
    address: liveEvm as `0x${string}` | undefined,
    chainId: evmChainId,
    query: { enabled: !!liveEvm },
  });

  // Remember live provider addresses as associations (never deletes others).
  // Selection state refreshes reactively via useWalletSelection.
  useEffect(() => {
    if (liveEvm) rememberWallet(liveEvm, 'EVM', evmWalletName ?? undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveEvm]);
  useEffect(() => {
    if (liveSol) rememberWallet(liveSol, 'SOLANA', solWalletName ?? undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSol]);
  useEffect(() => {
    if (open) refreshWallets();
  }, [open, refreshWallets]);

  // Support unread badge — sum of customerUnread across my tickets (poll 20s).
  // Depends on the resolved address STRING, never the associations array:
  // array identity churn (storage events, label touches) must not reset the
  // interval or fire immediate refetches.
  const supportAddr = useMemo(
    () => liveEvm ?? liveSol ?? associations[0]?.address ?? null,
    [liveEvm, liveSol, associations],
  );
  useEffect(() => {
    const addr = supportAddr;
    if (!open || !addr) {
      setSupportUnread(0);
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/support?wallet=${encodeURIComponent(addr)}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        const total = Array.isArray(data.tickets)
          ? data.tickets.reduce((n: number, t: { customerUnread?: number }) => n + (t.customerUnread ?? 0), 0)
          : 0;
        if (alive) setSupportUnread(total);
      } catch {}
    };
    void load();
    const t = setInterval(() => { void load(); }, 20000);
    return () => { alive = false; clearInterval(t); };
  }, [open, supportAddr]);

  // Solana native balance from RPC (blockchain = source of truth).
  useEffect(() => {
    if (!open || !liveSol) {
      setSolBalance(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const lamports = await connection.getBalance(new PublicKey(liveSol));
        if (!cancelled) setSolBalance((lamports / 1e9).toFixed(4));
      } catch {
        if (!cancelled) setSolBalance(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, liveSol, connection]);

  // KORAMP orders per associated wallet — one fetch per address, only while
  // open; single shared refresh timer, cleaned up on close/unmount.
  // Ticks are skipped when no ACTIVE (non-terminal) order exists: history is
  // static, so it loads once on open + explicit refresh instead of polling.
  const hasActiveRef = useRef(false);
  const fetchOrders = useCallback(async () => {
    const list = loadAssociations();
    if (list.length === 0) {
      setOrdersByWallet({});
      hasActiveRef.current = false;
      return;
    }
    setLoadingOrders(true);
    try {
      const entries = await Promise.all(
        list.map(async (w) => {
          try {
            const res = await fetch(
              `/api/wallets/${encodeURIComponent(w.address)}/orders?type=${w.ecosystem}&limit=30`,
              { cache: 'no-store' },
            );
            if (!res.ok) return [w.address, []] as const;
            const data = await res.json();
            const items = (data.items ?? []) as WalletOrderItem[];
            return [w.address, items] as const;
          } catch {
            return [w.address, []] as const;
          }
        }),
      );
      const byWallet = Object.fromEntries(entries);
      hasActiveRef.current = Object.values(byWallet)
        .flat()
        .some((o) => !isTerminalOrderStatus((o as WalletOrderItem).status));
      setOrdersByWallet(byWallet);
    } finally {
      setLoadingOrders(false);
    }
  }, []);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!open) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    void fetchOrders();
    pollRef.current = setInterval(() => {
      // No active transactions → history is static; skip network entirely.
      if (!hasActiveRef.current) return;
      void fetchOrders();
    }, 20000);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [open, fetchOrders]);

  // Escape to close + body scroll lock.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  const allOrders = useMemo(
    () => Object.values(ordersByWallet).flat().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [ordersByWallet],
  );
  const terminal = useMemo(
    () => new Set(['COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED', 'REFUNDED']),
    [],
  );
  const activeOrders = useMemo(() => allOrders.filter((o) => !terminal.has(o.status)), [allOrders, terminal]);
  const historyOrders = useMemo(() => allOrders.filter((o) => terminal.has(o.status)).slice(0, 10), [allOrders, terminal]);

  const handleSelect = (w: AssociatedWallet) => {
    setPreferredAddress(w.address, w.ecosystem, true);
    const live = w.ecosystem === 'EVM' ? liveEvm : liveSol;
    if (!live || live.toLowerCase() !== w.address.toLowerCase()) {
      toast.info(
        w.ecosystem === 'EVM'
          ? 'Wallet dipilih. Aktifkan akun ini di aplikasi EVM wallet Anda untuk tanda tangan.'
          : 'Wallet dipilih. Aktifkan akun ini di aplikasi Solana wallet Anda untuk tanda tangan.',
      );
    } else {
      toast.success('Wallet aktif dipilih.');
    }
    refreshWallets();
  };

  const handleDisconnect = async (w: AssociatedWallet) => {
    const live = w.ecosystem === 'EVM' ? liveEvm : liveSol;
    try {
      if (live && live.toLowerCase() === w.address.toLowerCase()) {
        if (w.ecosystem === 'EVM') disconnectEvm();
        else await disconnectSol();
      }
    } finally {
      forgetWallet(w.address, w.ecosystem);
      refreshWallets();
      toast.success('Wallet dilepas dari daftar.');
    }
  };

  const handleAdd = (ecosystem: AssociatedEcosystem) => {
    // Adding never disconnects existing wallets: both modals are additive.
    setAddingEcosystem(null);
    if (ecosystem === 'EVM') openEvmModal();
    else setSolVisible(true);
  };

  const explorerFor = (o: WalletOrderItem): string | null => {
    try {
      return getTxExplorerUrl(o.network as 'SOLANA' | 'BASE' | 'BSC', o.txHash ?? '');
    } catch {
      return null;
    }
  };

  return (
    <>
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] bg-black/60"
              onClick={onClose}
              aria-hidden
            />
            <motion.aside
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'tween', duration: 0.22, ease: 'easeOut' }}
              className="fixed top-0 right-0 bottom-0 z-[61] w-full sm:w-[400px] bg-base border-l border-line flex flex-col"
              role="dialog" aria-modal="true" aria-label="Menu wallet KORAMP"
            >
              <div className="flex items-center justify-between px-5 h-16 border-b border-line-subtle flex-shrink-0">
                <p className="text-white font-bold tracking-tight">MY KORAMP</p>
                <button onClick={onClose} aria-label="Tutup menu wallet" className="p-2 text-gray-500 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Wallet / Reward tabs */}
              <div className="flex gap-1 px-5 pt-3 flex-shrink-0" role="tablist" aria-label="Panel wallet">
                {(['wallet', 'reward'] as const).map((t) => (
                  <button
                    key={t}
                    role="tab"
                    aria-selected={panelTab === t}
                    onClick={() => setPanelTab(t)}
                    className={clsx(
                      'flex-1 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider border',
                      panelTab === t
                        ? 'border-brand-500/50 text-brand-400 bg-brand-600/10'
                        : 'border-line text-gray-500 hover:text-white',
                    )}
                  >
                    {t === 'wallet' ? 'Wallet' : 'Reward'}
                  </button>
                ))}
              </div>

              {panelTab === 'reward' ? (
                <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0">
                  <RewardPanel associations={associations} walletAddress={liveEvm ?? liveSol ?? associations[0]?.address ?? null} />
                </div>
              ) : (
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6 min-h-0">
                {/* ── Connected wallets, grouped per ecosystem ───── */}
                <section>
                  <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider mb-2">Connected Wallets</p>
                  {associations.length === 0 && (
                    <p className="text-gray-600 text-sm">Belum ada wallet. Tambahkan wallet pertama Anda di bawah.</p>
                  )}
                  {(['EVM', 'SOLANA'] as const).map((eco) => {
                    const group = associations.filter((w) => w.ecosystem === eco);
                    if (group.length === 0) return null;
                    const sel = eco === 'EVM' ? evmSel : solSel;
                    return (
                      <div key={eco} className="mb-3">
                        <p className="text-gray-600 text-[11px] font-semibold uppercase tracking-wider mb-1.5">
                          {eco === 'EVM' ? 'EVM' : 'Solana'}
                          {sel.mode === 'auto' && sel.selected && (
                            <span className="normal-case font-normal"> · otomatis terpilih</span>
                          )}
                          {sel.mode === 'none' && sel.count > 1 && (
                            <span className="normal-case font-normal text-yellow-500/90"> · pilih satu untuk transaksi</span>
                          )}
                        </p>
                        <div className="space-y-2">
                          {group.map((w) => {
                            const live = eco === 'EVM' ? liveEvm : liveSol;
                            const isLive = !!live && live.toLowerCase() === w.address.toLowerCase();
                            const isSelected = !!sel.selected && sel.selected.toLowerCase() === w.address.toLowerCase();
                            return (
                              <div key={`${w.ecosystem}:${w.address}`} className={clsx('bg-surface-1 border rounded-xl p-3', isSelected ? 'border-brand-500/40' : 'border-line-subtle')}>
                                <div className="flex items-center justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="text-white font-mono text-sm truncate">{shortAddress(w.address)}</p>
                                    <p className="text-gray-600 text-xs">
                                      {w.ecosystem === 'EVM' ? 'EVM' : 'Solana'}
                                      {w.ecosystem === 'EVM' && evmBalance && isLive && ` · ${Number(evmBalance.value) / 1e18 > 0 ? `${(Number(evmBalance.value) / 1e18).toFixed(4)} ${evmBalance.symbol}` : `0 ${evmBalance.symbol}`}`}
                                      {w.ecosystem === 'SOLANA' && isLive && solBalance !== null && ` · ${solBalance} SOL`}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-1.5 flex-shrink-0">
                                    {isLive && (
                                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/25">
                                        Live
                                      </span>
                                    )}
                                    {isSelected ? (
                                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand-600/15 text-brand-400 border border-brand-500/30">
                                        Selected
                                      </span>
                                    ) : (
                                      <button
                                        onClick={() => handleSelect(w)}
                                        className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-brand-500/30 text-brand-400 hover:bg-brand-600/10"
                                      >
                                        Use Wallet
                                      </button>
                                    )}
                                    <button
                                      onClick={() => { void handleDisconnect(w); }}
                                      aria-label="Disconnect wallet"
                                      title="Disconnect wallet"
                                      className="p-1.5 text-gray-600 hover:text-red-400"
                                    >
                                      <Unlink className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                                {isSelected && !isLive && (
                                  <p className="text-yellow-500/90 text-[11px] mt-1.5">
                                    Terpilih, tetapi belum aktif di wallet provider. Aktifkan akun ini di aplikasi wallet untuk tanda tangan — tidak ada pengalihan otomatis.
                                  </p>
                                )}
                                {!isSelected && !isLive && (
                                  <p className="text-gray-600 text-[11px] mt-1.5">
                                    Tersimpan — hubungkan akun ini di aplikasi wallet untuk menggunakannya on-chain.
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}

                  {/* ── Add wallet (additive, never disconnects) ── */}
                  {addingEcosystem === null ? (
                    <button
                      onClick={() => setAddingEcosystem('EVM')}
                      className="mt-2 w-full py-2.5 rounded-xl border border-dashed border-line-strong text-gray-400 hover:text-white hover:border-brand-500/50 text-sm font-semibold flex items-center justify-center gap-2"
                    >
                      <Plus className="w-4 h-4" /> Add Wallet
                    </button>
                  ) : (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button onClick={() => handleAdd('EVM')} className="btn-secondary text-sm py-2.5">EVM Wallet</button>
                      <button onClick={() => handleAdd('SOLANA')} className="btn-secondary text-sm py-2.5">Solana Wallet</button>
                    </div>
                  )}
                </section>

                {/* ── Active transactions (KORAMP order state) ─── */}
                <section>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider">Active Transactions</p>
                    <button
                      onClick={() => { void fetchOrders(); }}
                      aria-label="Muat ulang transaksi"
                      className="p-1 text-gray-600 hover:text-white"
                    >
                      <RefreshCw className={clsx('w-3.5 h-3.5', loadingOrders && 'animate-spin')} />
                    </button>
                  </div>
                  {activeOrders.length === 0 ? (
                    <p className="text-gray-600 text-sm">Tidak ada transaksi berjalan.</p>
                  ) : (
                    <div className="space-y-2">
                      {activeOrders.slice(0, 5).map((o) => (
                        <div key={o.publicId} className="bg-surface-1 border border-line-subtle rounded-xl p-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-white text-sm font-bold">
                              {o.side === 'TOP_UP' ? 'BUY' : 'SELL'} · {o.side === 'TOP_UP' ? `IDR → ${o.assetSymbol}` : `${o.assetSymbol} → IDR`}
                            </p>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400 border border-yellow-500/25 whitespace-nowrap">
                              {o.status.replace(/_/g, ' ')}
                            </span>
                          </div>
                          <p className="text-gray-600 text-xs mt-1 font-mono">{o.orderNumber}</p>
                          <button
                            onClick={() => { onClose(); router.push(`/order/${o.publicId}`); }}
                            className="mt-2 text-brand-400 text-xs font-semibold"
                          >
                            View →
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* ── KORAMP history (application data, user-scoped) ── */}
                <section>
                  <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider mb-2">Transaction History</p>
                  {historyOrders.length === 0 ? (
                    <p className="text-gray-600 text-sm">Belum ada riwayat transaksi KORAMP untuk wallet ini.</p>
                  ) : (
                    <div className="space-y-2">
                      {historyOrders.map((o) => (
                        <div key={o.publicId} className="bg-surface-1 border border-line-subtle rounded-xl p-3 flex items-center gap-3">
                          <div className={clsx(
                            'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
                            o.side === 'TOP_UP' ? 'bg-brand-600/15 text-brand-400' : 'bg-green-600/15 text-green-400',
                          )}>
                            {o.side === 'TOP_UP' ? <ArrowDownLeft className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-sm font-semibold truncate">
                              {o.side === 'TOP_UP' ? `IDR → ${o.assetSymbol}` : `${o.assetSymbol} → IDR`} · {o.status === 'COMPLETED' ? 'Completed' : o.status}
                            </p>
                            <p className="text-gray-600 text-xs">
                              {o.orderNumber} · {fmtTime(o.createdAt)}
                            </p>
                          </div>
                          <button
                            onClick={() => { onClose(); router.push(`/order/${o.publicId}`); }}
                            className="text-brand-400 text-xs font-semibold flex-shrink-0"
                          >
                            View
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* ── Wallet activity (blockchain = source of truth) ── */}
                <section>
                  <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider mb-2">Wallet Activity</p>
                  <p className="text-gray-600 text-xs mb-2">Aktivitas on-chain — sumber kebenaran adalah blockchain, lihat di explorer:</p>
                  <div className="space-y-1.5">
                    {associations.length === 0 && <p className="text-gray-700 text-xs">Hubungkan wallet untuk melihat activity.</p>}
                    {associations.map((w) => {
                      const url =
                        w.ecosystem === 'EVM'
                          ? `https://basescan.org/address/${w.address}`
                          : `https://solscan.io/account/${w.address}`;
                      return (
                        <a
                          key={`act:${w.ecosystem}:${w.address}`}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center justify-between text-xs text-gray-400 hover:text-white bg-surface-1 border border-line-subtle rounded-lg px-3 py-2"
                        >
                          <span className="font-mono">{shortAddress(w.address)}</span>
                          <span className="flex items-center gap-1">
                            {w.ecosystem === 'EVM' ? 'BaseScan' : 'Solscan'}
                            <ExternalLink className="w-3 h-3" />
                          </span>
                        </a>
                      );
                    })}
                  </div>
                </section>
                </div>
              )}

              {/* ── Support pinned at bottom ─────────────────── */}
              <div className="border-t border-line-subtle px-5 py-3 flex-shrink-0">
                <button
                  onClick={() => setSupportOpen(true)}
                  disabled={associations.length === 0 && !liveEvm && !liveSol}
                  className="btn-secondary w-full text-sm flex items-center justify-center gap-2 relative"
                >
                  <LifeBuoy className="w-4 h-4" /> Support
                  {supportUnread > 0 && (
                    <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-brand-500 text-white text-[10px] font-bold flex items-center justify-center">
                      {supportUnread > 99 ? '99+' : supportUnread}
                    </span>
                  )}
                </button>
                <p className="text-gray-700 text-[11px] text-center mt-1.5">Butuh bantuan? Laporkan langsung ke admin.</p>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <SupportModal
        open={supportOpen}
        onClose={() => setSupportOpen(false)}
        walletAddress={liveEvm ?? liveSol ?? associations[0]?.address ?? null}
        walletType={liveEvm ? 'EVM' : liveSol ? 'SOLANA' : (associations[0]?.ecosystem ?? null)}
        recentOrders={allOrders}
        onSubmitted={() => { void fetchOrders(); }}
      />
    </>
  );
}
