'use client';

/**
 * SolanaWalletModal — Dedicated Solana wallet connection modal.
 *
 * Shown when user clicks "+ SOL" or when a page needs a Solana wallet.
 * Only handles Phantom / Solflare / Backpack.
 * EVM wallets are handled entirely by RainbowKit's native ConnectButton modal.
 */

import { useEffect, useCallback } from 'react';
import { useWallet as useSolanaWallet } from '@solana/wallet-adapter-react';
import { WalletReadyState } from '@solana/wallet-adapter-base';
import { useWallet } from '@/contexts/WalletContext';
import { X, CheckCircle2, AlertCircle } from 'lucide-react';
import clsx from 'clsx';
import { TokenIcon } from '@/components/ui/TokenIcon';

const INSTALL_URLS: Record<string, string> = {
  Phantom:  'https://phantom.app/',
  Solflare: 'https://solflare.com/',
  Backpack: 'https://backpack.app/',
};

const ICONS: Record<string, string> = {
  Phantom:  '👻',
  Solflare: '🔥',
  Backpack: '🎒',
};

export function SolanaWalletModal() {
  const { showConnectModal, setShowConnectModal, solConnected, solAddress, solWalletName, disconnectSol, error, setError } = useWallet();
  const { wallets, select: selectWallet } = useSolanaWallet();

  // Close on Escape
  useEffect(() => {
    if (!showConnectModal) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowConnectModal(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showConnectModal, setShowConnectModal]);

  const handleConnect = useCallback((walletName: string) => {
    const wallet = wallets.find(w => w.adapter.name === walletName);
    if (!wallet || wallet.readyState === WalletReadyState.NotDetected) {
      window.open(INSTALL_URLS[walletName] ?? 'https://solana.com/ecosystem/explore?categories=wallet', '_blank');
      return;
    }
    setError(null);
    selectWallet(wallet.adapter.name);
  }, [wallets, selectWallet, setError]);

  if (!showConnectModal) return null;

  // Build wallet list — always show Phantom/Solflare/Backpack + any detected adapter
  const knownNames = ['Phantom', 'Solflare', 'Backpack'];
  const walletList = knownNames.map(name => {
    const found = wallets.find(w => w.adapter.name === name);
    const detected = found
      ? found.readyState === WalletReadyState.Installed || found.readyState === WalletReadyState.Loadable
      : false;
    return { name, icon: ICONS[name] ?? '●', detected };
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Connect Solana Wallet">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={() => setShowConnectModal(false)} />

      {/* Modal */}
      <div className="relative w-full max-w-sm bg-surface-2 border border-line rounded-2xl shadow-2xl overflow-hidden animate-fade-in">

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-line">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-purple-600/20 rounded-xl flex items-center justify-center">
              <TokenIcon symbol="SOL" size={20} />
            </div>
            <div>
              <h2 className="text-white font-bold text-base leading-tight">Solana Wallet</h2>
              <p className="text-gray-500 text-xs mt-0.5">Hubungkan Phantom, Solflare, atau Backpack</p>
            </div>
          </div>
          <button
            onClick={() => setShowConnectModal(false)}
            className="text-gray-500 hover:text-white p-1.5 rounded-lg hover:bg-white/5 transition-colors"
            aria-label="Tutup"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-3">
          {/* Error */}
          {error && (
            <div className="flex items-start gap-2.5 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-red-300 text-sm">{error}</p>
            </div>
          )}

          {/* Connected state */}
          {solConnected && solAddress ? (
            <div className="p-4 bg-purple-500/10 border border-purple-500/20 rounded-xl space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-purple-400" />
                <p className="text-purple-300 text-sm font-semibold">{solWalletName} terhubung</p>
              </div>
              <p className="text-white font-mono text-xs break-all">{solAddress}</p>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setShowConnectModal(false)}
                  className="btn-primary flex-1 py-2 px-3 text-sm"
                >
                  Selesai
                </button>
                <button
                  onClick={() => { disconnectSol(); }}
                  className="px-3 py-2 border border-red-500/30 text-red-400 hover:bg-red-500/10 rounded-lg text-sm transition-colors"
                >
                  Putuskan
                </button>
              </div>
            </div>
          ) : (
            /* Wallet list */
            <>
              {walletList.map(({ name, icon, detected }) => (
                <button
                  key={name}
                  onClick={() => handleConnect(name)}
                  className={clsx(
                    'w-full flex items-center gap-3 p-3.5 rounded-xl border text-left transition-all',
                    detected
                      ? 'border-line hover:border-line-strong hover:bg-white/5'
                      : 'border-line-subtle opacity-70 hover:opacity-100',
                  )}
                >
                  <span className="text-2xl w-8 text-center">{icon}</span>
                  <div className="flex-1">
                    <p className="text-white text-sm font-semibold">{name}</p>
                    <p className="text-gray-500 text-xs">{detected ? 'Terdeteksi' : 'Klik untuk install →'}</p>
                  </div>
                  {detected && <div className="w-2 h-2 bg-green-400 rounded-full" />}
                </button>
              ))}

              <p className="text-gray-600 text-xs text-center pt-1">
                Kiswap tidak pernah meminta private key atau seed phrase.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
