'use client';

/**
 * WalletButton — navbar wallet entry (right edge).
 *
 * EVM: RainbowKit NATIVE <ConnectButton /> — modal, account view, network
 * switch, and disconnect all come from RainbowKit. No custom EVM wallet UI.
 * Solana: compact SOL pill. Connect opens the OFFICIAL wallet-adapter modal;
 * connected pill opens WalletPanel (address, network, balance, history).
 */

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { useWallet } from '@/contexts/WalletContext';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { WalletPanel } from './WalletPanel';
import { ChevronDown, RefreshCw } from 'lucide-react';
import clsx from 'clsx';

// Lazy-load ConnectButton — RainbowKit uses browser APIs not available on SSR.
const ConnectButton = dynamic(
  () => import('@rainbow-me/rainbowkit').then((m) => ({ default: m.ConnectButton })),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center gap-2 px-4 py-2 bg-brand-600 rounded-xl text-sm text-white/70 h-10">
        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
        <span className="hidden sm:inline">Wallet</span>
      </div>
    ),
  },
);

function short(addr: string): string {
  return addr.length <= 12 ? addr : `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

export function WalletButton() {
  const { solConnected, solAddress } = useWallet();
  const { setVisible } = useWalletModal();
  const [panelOpen, setPanelOpen] = useState(false);

  return (
    <>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {/* EVM — 100% RainbowKit native */}
        <ConnectButton
          chainStatus="icon"
          showBalance={false}
          accountStatus={{ smallScreen: 'avatar', largeScreen: 'full' }}
          label="Connect Wallet"
        />

        {/* Solana — official modal for connect, WalletPanel for account */}
        {solConnected && solAddress ? (
          <button
            type="button"
            onClick={() => setPanelOpen(true)}
            aria-label="Buka panel wallet Solana"
            className="flex items-center gap-1.5 h-10 px-3 rounded-xl bg-surface-2 border border-line hover:border-line-strong transition-colors"
          >
            <span className="w-2 h-2 rounded-full bg-purple-400 flex-shrink-0" />
            <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full border text-purple-400 bg-purple-500/10 border-purple-500/20">
              SOL
            </span>
            <span className="text-white font-mono text-xs">{short(solAddress)}</span>
            <ChevronDown className="w-3 h-3 text-gray-500 hidden sm:block" aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setVisible(true)}
            title="Hubungkan Solana wallet (Phantom/Solflare)"
            aria-label="Hubungkan Solana wallet"
            className={clsx(
              'h-10 px-3 rounded-xl bg-surface-2 border border-line hover:border-line-strong',
              'text-white font-mono text-xs transition-colors',
            )}
          >
            SOL
          </button>
        )}
      </div>
      <WalletPanel open={panelOpen} onClose={() => setPanelOpen(false)} />
    </>
  );
}
