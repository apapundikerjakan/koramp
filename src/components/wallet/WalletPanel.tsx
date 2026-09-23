'use client';

/**
 * WalletPanel — right-edge drawer for the connected SOLANA wallet.
 *
 * EVM account UI (name/ENS/address/disconnect/switch) comes from the
 * RainbowKit native account modal — this panel is Solana-only.
 * Data on-demand from RPC, keyed by address (no mixing between wallets).
 * No account system, no DB writes. Backend transaksi tidak disentuh.
 */

import { useEffect, useState } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { useWallet } from '@/contexts/WalletContext';
import { getTxExplorerUrl, isRampSupported } from '@/lib/assets';
import {
  X, Copy, Check, RefreshCw, LogOut, ExternalLink, Wallet,
} from 'lucide-react';
import clsx from 'clsx';

function short(addr: string): string {
  return addr.length <= 12 ? addr : `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

function useCopy(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const copy = (text: string) => {
    try {
      navigator.clipboard.writeText(text);
    } catch {
      /* clipboard unavailable — tetap beri feedback */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return [copied, copy];
}

interface SolSig {
  signature: string;
  err: unknown;
  blockTime: number | null | undefined;
}

function useSolanaData(address: string | null, refreshKey: number) {
  const { connection } = useConnection();
  const [balance, setBalance] = useState<string | null>(null);
  const [txs, setTxs] = useState<SolSig[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Ganti wallet → reset state dulu supaya history lama tak terbawa.
    setBalance(null);
    setTxs([]);
    setError(null);
    if (!address) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const pk = new PublicKey(address);
        const [lamports, sigs] = await Promise.all([
          connection.getBalance(pk),
          connection.getSignaturesForAddress(pk, { limit: 10 }),
        ]);
        if (cancelled) return;
        setBalance(parseFloat((lamports / LAMPORTS_PER_SOL).toFixed(6)).toString());
        setTxs(sigs.map((s) => ({ signature: s.signature, err: s.err, blockTime: s.blockTime })));
      } catch {
        if (!cancelled) setError('Gagal memuat data on-chain. Coba refresh.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address, connection, refreshKey]);

  return { balance, txs, loading, error };
}

export function WalletPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { solConnected, solAddress, solWalletName, disconnectSol } = useWallet();
  const [refreshKey, setRefreshKey] = useState(0);
  const { balance, txs, loading, error } = useSolanaData(solAddress, refreshKey);
  const shown = { balance, txs, loading, error };
  const [refreshing, setRefreshing] = useState(false);
  const [copied, copy] = useCopy();

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const handleRefresh = () => {
    setRefreshing(true);
    setRefreshKey((k) => k + 1);
    setTimeout(() => setRefreshing(false), 800);
  };

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Wallet panel Solana">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <aside className="absolute right-0 top-0 h-full w-full max-w-sm bg-surface-2 border-l border-line shadow-2xl animate-fade-in flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-line flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-brand-600/20 rounded-xl flex items-center justify-center">
              <Wallet className="w-4 h-4 text-brand-400" />
            </div>
            <h2 className="text-white font-bold text-base">Solana Wallet</h2>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={handleRefresh} aria-label="Refresh balance dan history"
              className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors">
              <RefreshCw className={clsx('w-4 h-4', refreshing && 'animate-spin')} />
            </button>
            <button onClick={onClose} aria-label="Tutup panel"
              className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!solConnected || !solAddress ? (
            <p className="text-gray-500 text-sm text-center py-8">Solana wallet belum terhubung.</p>
          ) : (
            <section className="border border-line-subtle rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-line-subtle flex items-center justify-between">
                <span className="text-white text-sm font-semibold truncate">
                  {solWalletName ?? 'Solana Wallet'}
                </span>
                <span className="text-xs text-purple-400 flex-shrink-0">Solana Devnet</span>
              </div>

              {isRampSupported('SOLANA') && (
                <div className="px-4 pt-3">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border bg-green-500/10 text-green-300 border-green-500/20">
                    Ramp: Top Up & Sell tersedia
                  </span>
                </div>
              )}

              <div className="p-4 space-y-3">
                <div>
                  <p className="text-gray-500 text-xs mb-1">Wallet address</p>
                  <div className="flex items-center gap-2">
                    <p className="text-white font-mono text-xs flex-1 break-all leading-relaxed">{solAddress}</p>
                    <button onClick={() => copy(solAddress)} aria-label="Salin alamat Solana"
                      className="flex-shrink-0 p-2 rounded-lg hover:bg-white/5 text-gray-400 hover:text-white transition-colors">
                      {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-500">Balance</span>
                  <span className="tnum text-white font-bold">
                    {shown.loading && shown.balance === null ? '…' : `${shown.balance ?? '—'} SOL`}
                  </span>
                </div>

                <div>
                  <p className="text-gray-500 text-xs mb-2">Transaction history</p>
                  {shown.loading && shown.txs.length === 0 ? (
                    <p className="text-gray-500 text-xs">Memuat history on-chain…</p>
                  ) : shown.error ? (
                    <p className="text-red-400 text-xs">{shown.error}</p>
                  ) : shown.txs.length === 0 ? (
                    <p className="text-gray-600 text-xs">Belum ada transaksi untuk wallet ini.</p>
                  ) : (
                    <ul className="space-y-2">
                      {shown.txs.map((t) => (
                        <li key={t.signature} className="flex items-center gap-2 text-xs">
                          <span className={clsx('w-1.5 h-1.5 rounded-full flex-shrink-0', t.err ? 'bg-red-400' : 'bg-green-400')} />
                          <span className="text-gray-300 font-mono flex-1 truncate">{short(t.signature)}</span>
                          <span className="text-gray-600 flex-shrink-0">
                            {t.blockTime ? new Date(t.blockTime * 1000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) : '—'}
                          </span>
                          <a href={getTxExplorerUrl('SOLANA', t.signature)} target="_blank" rel="noopener noreferrer"
                            aria-label="Lihat transaksi di explorer" className="flex-shrink-0 text-gray-500 hover:text-white transition-colors">
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <button onClick={() => { void disconnectSol(); onClose(); }}
                  className="w-full flex items-center justify-center gap-2 py-2.5 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/5 border border-line-subtle rounded-xl transition-colors">
                  <LogOut className="w-4 h-4" /> Disconnect
                </button>
              </div>
            </section>
          )}
          <p className="text-center text-gray-600 text-xs pb-2">
            KORAMP tidak pernah meminta private key atau seed phrase.
          </p>
        </div>
      </aside>
    </div>
  );
}
