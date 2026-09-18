'use client';

/**
 * UnifiedWalletModal — ONE wallet popup for EVM + Solana.
 *
 * EVM entries delegate to RainbowKit-configured wagmi connectors
 * (MetaMask / Rabby / Coinbase / WalletConnect) — no second RainbowKit
 * selection dialog is opened; selection happens here.
 * Solana entries delegate to official Solana wallet adapters
 * (Phantom / Solflare / Backpack).
 *
 * Allows connecting EVM and Solana wallets simultaneously.
 * - Does NOT auto-close when one wallet connects — stays open so user
 *   can connect both ecosystems in one session.
 * - Shows connected state per ecosystem so user knows what's already connected.
 * - "Done" button closes the modal explicitly.
 */

import { useEffect, useCallback, useState } from 'react';
import { useConnectors, type Connector } from 'wagmi';
import { useWallet as useSolanaWallet } from '@solana/wallet-adapter-react';
import { WalletReadyState } from '@solana/wallet-adapter-base';
import { useWallet } from '@/contexts/WalletContext';
import { TokenIcon } from '@/components/ui/TokenIcon';
import { CHAIN_NAMES } from '@/lib/assets';
import {
  X, Wallet, CheckCircle2, AlertCircle, ExternalLink,
  RefreshCw, LogOut, ChevronDown,
} from 'lucide-react';
import clsx from 'clsx';

// ─── EVM wallet list ──────────────────────────────────────────────────────────

interface EvmWalletMeta {
  id: string;
  name: string;
  icon: string;
  installUrl: string;
  rdns?: string;
  /** RainbowKit/wagmi connector ids that may back this entry. */
  rkIds?: string[];
}

const EVM_WALLETS: EvmWalletMeta[] = [
  { id: 'io.metamask',       name: 'MetaMask',        icon: '🦊', installUrl: 'https://metamask.io/download/',                rdns: 'io.metamask',  rkIds: ['metaMask', 'metaMaskSDK', 'injected'] },
  { id: 'io.rabby',          name: 'Rabby',            icon: '🐰', installUrl: 'https://rabby.io/',                             rdns: 'io.rabby',     rkIds: ['rabby', 'rabbyWallet', 'injected'] },
  { id: 'coinbaseWalletSDK', name: 'Coinbase Wallet',  icon: '🔵', installUrl: 'https://www.coinbase.com/wallet/downloads',   rkIds: ['coinbaseWallet', 'coinbaseWalletSDK'] },
  { id: 'walletConnect',     name: 'WalletConnect',    icon: '🔗', installUrl: 'https://walletconnect.com/',                  rkIds: ['walletConnect'] },
];

const SOLANA_INSTALL: Record<string, string> = {
  Phantom:  'https://phantom.app/',
  Solflare: 'https://solflare.com/',
  Backpack: 'https://backpack.app/',
  MetaMask: 'https://metamask.io/',
  'OKX Wallet': 'https://www.okx.com/web3',
};

const SOLANA_ICONS: Record<string, string> = {
  Phantom: '👻', Solflare: '🔥', Backpack: '🎒', MetaMask: '🦊', 'OKX Wallet': '💠',
};

// ─── Component (canonical name) ─────────────────────────────────────────────

export function UnifiedWalletModal() {
  const {
    showConnectModal, setShowConnectModal,
    error, setError,
    connectEvm, disconnectEvm, disconnectSol,
    evmConnected, evmAddress, evmWalletName, evmWrongNetwork, evmChainId,
    solConnected, solAddress, solWalletName,
    isConnecting, switchToChain,
  } = useWallet();

  const connectors = useConnectors();
  const { wallets: solWallets, select: selectSolWallet } = useSolanaWallet();
  const [switchingChain, setSwitchingChain] = useState(false);

  // Close on Escape
  useEffect(() => {
    if (!showConnectModal) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowConnectModal(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showConnectModal, setShowConnectModal]);

  // Match wagmi connector for an EVM wallet entry (RainbowKit-backed).
  const findConnector = useCallback((meta: EvmWalletMeta): Connector | undefined => {
    return (
      connectors.find(c => c.id === meta.id) ??
      connectors.find(c => meta.rdns !== undefined && c.id === meta.rdns) ??
      connectors.find(c => meta.rkIds !== undefined && meta.rkIds.includes(c.id)) ??
      connectors.find(c => c.name.toLowerCase() === meta.name.toLowerCase()) ??
      connectors.find(c => c.name.toLowerCase().includes(meta.name.toLowerCase()))
    );
  }, [connectors]);

  const handleEvmConnect = useCallback((meta: EvmWalletMeta) => {
    const connector = findConnector(meta);
    if (!connector) {
      setError(`${meta.name} tidak tersedia. Pasang ekstensinya terlebih dahulu.`);
      return;
    }
    connectEvm(connector);
  }, [findConnector, connectEvm, setError]);

  const handleSolanaConnect = useCallback((walletName: string) => {
    const wallet = solWallets.find(w => w.adapter.name === walletName);
    if (!wallet || wallet.readyState === WalletReadyState.NotDetected) {
      window.open(SOLANA_INSTALL[walletName] ?? 'https://solana.com/ecosystem/explore?categories=wallet', '_blank');
      return;
    }
    setError(null);
    selectSolWallet(wallet.adapter.name);
  }, [solWallets, selectSolWallet, setError]);

  const handleSwitchChain = async (chainId: number) => {
    setSwitchingChain(true);
    await switchToChain(chainId);
    setSwitchingChain(false);
  };

  if (!showConnectModal) return null;

  // Build lists
  const evmList = EVM_WALLETS.map(meta => {
    const connector = findConnector(meta);
    return { ...meta, connector, detected: !!connector, wcUnavailable: meta.id === 'walletConnect' && !connector };
  });

  type SolEntry = { name: string; icon: string; detected: boolean; installUrl: string };
  const solList: SolEntry[] = [
    ...solWallets
      .filter(w => w.readyState !== WalletReadyState.Unsupported)
      .map(w => ({
        name: w.adapter.name as string,
        icon: w.adapter.icon,
        detected: w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable,
        installUrl: SOLANA_INSTALL[w.adapter.name] ?? '',
      })),
  ];
  // Ensure default entries exist even if adapter not detected
  ['Phantom', 'Solflare', 'Backpack'].forEach(name => {
    if (!solList.find(w => w.name === name)) {
      solList.push({ name, icon: '', detected: false, installUrl: SOLANA_INSTALL[name] ?? '' });
    }
  });

  const bothConnected = evmConnected && solConnected;
  const eitherConnected = evmConnected || solConnected;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      role="dialog" aria-modal="true" aria-label="Connect Wallet"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={() => setShowConnectModal(false)} />

      {/* Modal */}
      <div className="relative w-full max-w-md bg-surface-2 border border-line rounded-2xl shadow-2xl animate-fade-in overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-line">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-brand-600/20 rounded-xl flex items-center justify-center">
              <Wallet className="w-5 h-5 text-brand-400" />
            </div>
            <div>
              <h2 className="text-white font-bold text-base leading-tight">Hubungkan Wallet</h2>
              <p className="text-gray-500 text-xs mt-0.5">
                {bothConnected ? '✓ EVM & Solana terhubung' : 'Hubungkan satu atau dua ekosistem'}
              </p>
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

        <div className="px-5 pb-5 space-y-5 max-h-[80vh] overflow-y-auto">

          {/* Error banner */}
          {error && (
            <div className="flex items-start gap-2.5 p-3 mt-4 bg-red-500/10 border border-red-500/20 rounded-xl">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-red-300 text-sm">{error}</p>
            </div>
          )}

          {/* ── EVM Section ─────────────────────────────────────────────────── */}
          <div className="pt-3">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <TokenIcon symbol="ETH" size={14} />
                <TokenIcon symbol="BNB" size={14} />
                <p className="text-gray-300 text-sm font-semibold">EVM — Base Sepolia & BSC Testnet</p>
                <span className="text-gray-600 text-xs">ETH / BNB</span>
              </div>
              {evmConnected && (
                <span className="flex items-center gap-1 text-xs text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded-full">
                  <CheckCircle2 className="w-3 h-3" /> Terhubung
                </span>
              )}
            </div>

            {/* Connected EVM state */}
            {evmConnected && evmAddress && (
              <div className={clsx(
                'mb-3 p-3 rounded-xl border',
                evmWrongNetwork ? 'bg-red-500/10 border-red-500/30' : 'bg-green-500/10 border-green-500/20',
              )}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-500 mb-0.5">{evmWalletName ?? 'EVM Wallet'}</p>
                    <p className="text-white font-mono text-xs">{evmAddress.slice(0, 8)}...{evmAddress.slice(-6)}</p>
                    <p className="text-gray-500 text-xs mt-0.5">
                      Terdeteksi: {evmChainId != null ? (CHAIN_NAMES[evmChainId] ?? `Chain ${evmChainId}`) : '—'}
                    </p>
                    {evmWrongNetwork && (
                      <p className="text-red-400 text-xs mt-1">⚠ Network salah — switch ke Base Sepolia atau BSC Testnet</p>
                    )}
                  </div>
                  <button
                    onClick={() => disconnectEvm()}
                    className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded-lg hover:bg-red-500/10 transition-colors"
                  >
                    <LogOut className="w-3 h-3" /> Putuskan
                  </button>
                </div>

                {/* Network switch shortcuts */}
                {evmWrongNetwork && (
                  <div className="flex gap-2 mt-2">
                    {[
                      { id: 84532, label: 'Base Sepolia', color: 'text-blue-400 border-blue-500/30 bg-blue-500/10' },
                      { id: 97,    label: 'BSC Testnet',  color: 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10' },
                    ].map(n => (
                      <button
                        key={n.id}
                        onClick={() => handleSwitchChain(n.id)}
                        disabled={switchingChain}
                        className={clsx('flex-1 py-1.5 text-xs font-semibold rounded-lg border transition-all disabled:opacity-50', n.color,
                          evmChainId === n.id ? 'opacity-100' : 'opacity-70 hover:opacity-100',
                        )}
                      >
                        {switchingChain ? <RefreshCw className="w-3 h-3 animate-spin mx-auto" /> : (evmChainId === n.id ? `✓ ${n.label}` : n.label)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* EVM wallet buttons — hide list if already connected & correct network */}
            {(!evmConnected || evmWrongNetwork) && (
              <div className="space-y-2">
                {evmList.map(w => (
                  <button
                    key={w.id}
                    onClick={() => handleEvmConnect(w)}
                    disabled={isConnecting}
                    className="w-full flex items-center gap-3 p-3.5 bg-surface-2 hover:bg-surface-3 border border-line hover:border-brand-600/40 rounded-xl transition-all text-left group disabled:opacity-60"
                  >
                    <span className="text-2xl w-8 text-center">{w.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-semibold group-hover:text-brand-300 transition-colors">{w.name}</p>
                      <p className="text-gray-500 text-xs">
                        {w.name === 'WalletConnect' ? 'Mobile & hardware wallets' : 'Browser extension'}
                      </p>
                    </div>
                    {w.wcUnavailable ? (
                      <span className="text-xs text-gray-500 bg-white/5 border border-white/10 px-2 py-0.5 rounded-full flex-shrink-0">Not configured</span>
                    ) : w.detected ? (
                      <span className="flex items-center gap-1 text-xs text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded-full flex-shrink-0">
                        <CheckCircle2 className="w-3 h-3" /> Detected
                      </span>
                    ) : w.name === 'WalletConnect' ? (
                      <span className="text-xs text-brand-400 bg-brand-500/10 border border-brand-500/20 px-2 py-0.5 rounded-full flex-shrink-0">QR / Link</span>
                    ) : (
                      <a href={w.installUrl} target="_blank" rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 flex-shrink-0">
                        Install <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </button>
                ))}
              </div>
            )}

            {evmConnected && !evmWrongNetwork && (
              <p className="text-gray-600 text-xs text-center mt-1">
                EVM wallet terhubung — klik &quot;Putuskan&quot; di atas untuk ganti wallet
              </p>
            )}
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-line" />
            <span className="text-gray-600 text-xs">atau hubungkan juga</span>
            <div className="flex-1 h-px bg-line" />
          </div>

          {/* ── Solana Section ───────────────────────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <TokenIcon symbol="SOL" size={14} />
                <p className="text-gray-300 text-sm font-semibold">Solana</p>
                <span className="text-gray-600 text-xs">SOL — Devnet</span>
              </div>
              {solConnected && (
                <span className="flex items-center gap-1 text-xs text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded-full">
                  <CheckCircle2 className="w-3 h-3" /> Terhubung
                </span>
              )}
            </div>

            {/* Connected Solana state */}
            {solConnected && solAddress && (
              <div className="mb-3 p-3 rounded-xl border bg-green-500/10 border-green-500/20">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-500 mb-0.5">{solWalletName ?? 'Solana Wallet'}</p>
                    <p className="text-white font-mono text-xs">{solAddress.slice(0, 8)}...{solAddress.slice(-6)}</p>
                  </div>
                  <button
                    onClick={() => disconnectSol()}
                    className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded-lg hover:bg-red-500/10 transition-colors"
                  >
                    <LogOut className="w-3 h-3" /> Putuskan
                  </button>
                </div>
              </div>
            )}

            {/* Solana wallet buttons */}
            {!solConnected && (
              <div className="space-y-2">
                {solList.map(w => (
                  <button
                    key={w.name}
                    onClick={() => handleSolanaConnect(w.name)}
                    disabled={isConnecting}
                    className="w-full flex items-center gap-3 p-3.5 bg-surface-2 hover:bg-surface-3 border border-line hover:border-line-strong rounded-xl transition-all text-left group disabled:opacity-60"
                  >
                    {w.icon ? (
                      <img src={w.icon} alt={w.name} width={32} height={32} className="w-8 h-8 rounded-lg" />
                    ) : (
                      <span className="text-2xl w-8 text-center">{SOLANA_ICONS[w.name] ?? '●'}</span>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-semibold group-hover:text-purple-300 transition-colors">{w.name}</p>
                      <p className="text-gray-500 text-xs">Solana wallet</p>
                    </div>
                    {w.detected ? (
                      <span className="flex items-center gap-1 text-xs text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded-full flex-shrink-0">
                        <CheckCircle2 className="w-3 h-3" /> Detected
                      </span>
                    ) : (
                      <a href={w.installUrl} target="_blank" rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 flex-shrink-0">
                        Install <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </button>
                ))}
              </div>
            )}

            {solConnected && (
              <p className="text-gray-600 text-xs text-center mt-1">
                Solana wallet terhubung — klik &quot;Putuskan&quot; di atas untuk ganti wallet
              </p>
            )}
          </div>

          {/* Done button — visible when at least one wallet connected */}
          {eitherConnected && (
            <button
              onClick={() => setShowConnectModal(false)}
              className="w-full py-3 bg-brand-600 hover:bg-brand-500 text-white font-semibold rounded-xl transition-colors text-sm"
            >
              {bothConnected ? '✓ Kedua wallet terhubung — Selesai' : 'Selesai'}
            </button>
          )}

          {/* Security note */}
          <p className="text-center text-gray-600 text-xs pb-1">
            Kipramp tidak pernah meminta private key atau seed phrase.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Deprecated alias — use UnifiedWalletModal. Kept so old imports keep working. */
export const ConnectWalletModal = UnifiedWalletModal;

