'use client';

/**
 * WalletButton — Dual-ecosystem wallet status in the navbar.
 *
 * EVM side:    RainbowKit <ConnectButton> — default popup, native account modal,
 *              chain switching, all built-in RainbowKit UX.
 *              Lazy-loaded with next/dynamic (ssr:false) to prevent SSR mismatch.
 * Solana side: Custom pill (Phantom/Solflare/Backpack) with address + dropdown.
 */

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { useWallet } from '@/contexts/WalletContext';
import { ChevronDown, Copy, LogOut, CheckCircle2, Plus, RefreshCw } from 'lucide-react';
import clsx from 'clsx';

// Lazy-load ConnectButton — RainbowKit uses browser APIs not available on SSR.
const ConnectButton = dynamic(
  () => import('@rainbow-me/rainbowkit').then((m) => m.ConnectButton),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center gap-2 px-4 py-2 bg-brand-600 rounded-xl text-sm text-white/70">
        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
        <span className="hidden sm:inline">Wallet</span>
      </div>
    ),
  },
);

function short(addr: string): string {
  return addr.length <= 12 ? addr : `${addr.slice(0, 5)}...${addr.slice(-4)}`;
}

export function WalletButton() {
  const {
    solConnected, solAddress, solWalletName,
    disconnectSol, setShowConnectModal,
  } = useWallet();

  const [solOpen, setSolOpen] = useState(false);
  const [copiedSol, setCopiedSol] = useState(false);

  const copySol = () => {
    if (solAddress) {
      navigator.clipboard.writeText(solAddress);
      setCopiedSol(true);
      setTimeout(() => setCopiedSol(false), 2000);
    }
  };

  return (
    <div className="flex items-center gap-2">

      {/* ── EVM: RainbowKit ConnectButton (default UI, SSR-safe) ───────────── */}
      <ConnectButton
        chainStatus="icon"
        showBalance={false}
        accountStatus={{ smallScreen: 'avatar', largeScreen: 'full' }}
        label="Connect Wallet"
      />

      {/* ── Solana: custom pill ────────────────────────────────────────────── */}
      {solConnected && solAddress ? (
        <div className="relative">
          <button
            onClick={() => setSolOpen(!solOpen)}
            className="flex items-center gap-1.5 px-3 py-2 bg-[#0f0f2a] border border-[#1e1e48] hover:border-purple-600/40 rounded-xl text-sm transition-all"
          >
            <span className="w-2 h-2 bg-purple-400 rounded-full" />
            <span className="text-xs font-semibold hidden sm:inline px-1.5 py-0.5 rounded-full border text-purple-400 bg-purple-500/10 border-purple-500/20">
              SOL
            </span>
            <span className="text-white font-mono text-xs">{short(solAddress)}</span>
            <ChevronDown className={clsx('w-3 h-3 text-gray-500 transition-transform', solOpen && 'rotate-180')} />
          </button>

          {solOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setSolOpen(false)} />
              <div className="absolute right-0 top-full mt-2 w-64 bg-[#0c0c22] border border-[#1e1e48] rounded-xl shadow-2xl z-50 overflow-hidden">
                <div className="px-4 py-3 border-b border-[#1e1e48]">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-gray-500 text-xs">{solWalletName ?? 'Solana Wallet'}</span>
                    <span className="text-xs text-purple-400">Solana</span>
                  </div>
                  <p className="text-white text-xs font-mono break-all leading-relaxed">{solAddress}</p>
                </div>
                <div className="p-1">
                  <button
                    onClick={copySol}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                  >
                    {copiedSol ? <CheckCircle2 className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                    {copiedSol ? 'Disalin!' : 'Salin Alamat'}
                  </button>
                  <button
                    onClick={() => { disconnectSol(); setSolOpen(false); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/5 rounded-lg transition-colors"
                  >
                    <LogOut className="w-4 h-4" /> Putuskan Solana
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      ) : (
        /* "+ SOL" pill to add Solana wallet alongside EVM */
        <button
          onClick={() => setShowConnectModal(true)}
          title="Tambah Solana wallet"
          className="flex items-center gap-1 px-2.5 py-2 bg-[#0f0f2a] border border-[#1e1e48] hover:border-purple-600/40 rounded-xl text-gray-500 hover:text-purple-400 transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          <span className="hidden sm:inline text-xs font-semibold">SOL</span>
        </button>
      )}
    </div>
  );
}
