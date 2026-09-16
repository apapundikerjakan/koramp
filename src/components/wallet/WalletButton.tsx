'use client';

import { useState } from 'react';
import { useWallet } from '@/contexts/WalletContext';
import { ChevronDown, Copy, LogOut, CheckCircle2, RefreshCw, Plus, AlertTriangle } from 'lucide-react';
import clsx from 'clsx';

function short(addr: string): string {
  return addr.length <= 12 ? addr : `${addr.slice(0, 5)}...${addr.slice(-4)}`;
}

export function WalletButton() {
  const {
    isConnecting,
    evmConnected, evmAddress, evmWalletName, evmWrongNetwork, evmChainId,
    solConnected, solAddress, solWalletName,
    isConnected, setShowConnectModal,
    disconnectEvm, disconnectSol, switchToChain,
  } = useWallet();

  const [evmOpen, setEvmOpen]     = useState(false);
  const [solOpen, setSolOpen]     = useState(false);
  const [copiedEvm, setCopiedEvm] = useState(false);
  const [copiedSol, setCopiedSol] = useState(false);

  if (isConnecting && !isConnected) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-[#0f0f2a] border border-[#1e1e48] rounded-xl text-sm text-gray-400">
        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
        <span className="hidden sm:block">Connecting...</span>
      </div>
    );
  }

  if (!evmConnected && !solConnected) {
    return (
      <button onClick={() => setShowConnectModal(true)} className="btn-primary flex items-center gap-2 py-2 px-4 text-sm">
        Connect Wallet
      </button>
    );
  }

  const copyEvm = () => { if (evmAddress) { navigator.clipboard.writeText(evmAddress); setCopiedEvm(true); setTimeout(() => setCopiedEvm(false), 2000); } };
  const copySol = () => { if (solAddress) { navigator.clipboard.writeText(solAddress); setCopiedSol(true); setTimeout(() => setCopiedSol(false), 2000); } };

  return (
    <div className="flex items-center gap-2">
      {/* EVM pill */}
      {evmConnected && evmAddress && (
        <div className="relative">
          <button
            onClick={() => { setEvmOpen(!evmOpen); setSolOpen(false); }}
            className={clsx('flex items-center gap-1.5 px-3 py-2 border rounded-xl text-sm transition-all',
              evmWrongNetwork ? 'bg-red-500/10 border-red-500/30' : 'bg-[#0f0f2a] border-[#1e1e48] hover:border-brand-600/40',
            )}
          >
            {evmWrongNetwork ? <AlertTriangle className="w-3.5 h-3.5 text-red-400" /> : <span className="w-2 h-2 bg-blue-400 rounded-full" />}
            <span className={clsx('text-xs font-semibold hidden sm:inline px-1.5 py-0.5 rounded-full border',
              evmWrongNetwork ? 'text-red-400 bg-red-500/10 border-red-500/30' : 'text-blue-400 bg-blue-500/10 border-blue-500/20',
            )}>EVM</span>
            <span className="text-white font-mono text-xs">{short(evmAddress)}</span>
            <ChevronDown className={clsx('w-3 h-3 text-gray-500 transition-transform', evmOpen && 'rotate-180')} />
          </button>
          {evmOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setEvmOpen(false)} />
              <WalletDropdown
                label={evmWalletName ?? 'EVM Wallet'}
                address={evmAddress}
                network={evmWrongNetwork ? '⚠ Wrong Network' : evmChainId === 84532 ? 'Base Sepolia' : evmChainId === 97 ? 'BSC Testnet' : `Chain ${evmChainId}`}
                networkColor={evmWrongNetwork ? 'text-red-400' : 'text-blue-400'}
                copied={copiedEvm} onCopy={copyEvm}
                onDisconnect={() => { disconnectEvm(); setEvmOpen(false); }}
                onClose={() => setEvmOpen(false)}
                extra={evmWrongNetwork ? (
                  <div className="px-4 py-2 border-b border-[#1e1e48]">
                    <p className="text-gray-600 text-xs mb-1.5">Switch ke testnet:</p>
                    <div className="flex gap-2">
                      {[{ id: 84532, label: 'Base Sepolia' }, { id: 97, label: 'BSC Testnet' }].map(n => (
                        <button key={n.id} onClick={async () => { const ok = await switchToChain(n.id); if (ok) setEvmOpen(false); }}
                          className="flex-1 py-1.5 text-xs font-semibold rounded-lg border text-blue-400 border-blue-500/30 bg-blue-500/10 hover:opacity-80">
                          {n.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              />
            </>
          )}
        </div>
      )}

      {/* Solana pill */}
      {solConnected && solAddress && (
        <div className="relative">
          <button
            onClick={() => { setSolOpen(!solOpen); setEvmOpen(false); }}
            className="flex items-center gap-1.5 px-3 py-2 bg-[#0f0f2a] border border-[#1e1e48] hover:border-purple-600/40 rounded-xl text-sm transition-all"
          >
            <span className="w-2 h-2 bg-purple-400 rounded-full" />
            <span className="text-xs font-semibold hidden sm:inline text-purple-400 bg-purple-500/10 border border-purple-500/20 px-1.5 py-0.5 rounded-full">SOL</span>
            <span className="text-white font-mono text-xs">{short(solAddress)}</span>
            <ChevronDown className={clsx('w-3 h-3 text-gray-500 transition-transform', solOpen && 'rotate-180')} />
          </button>
          {solOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setSolOpen(false)} />
              <WalletDropdown
                label={solWalletName ?? 'Solana Wallet'}
                address={solAddress}
                network="Solana Devnet" networkColor="text-purple-400"
                copied={copiedSol} onCopy={copySol}
                onDisconnect={() => { disconnectSol(); setSolOpen(false); }}
                onClose={() => setSolOpen(false)}
              />
            </>
          )}
        </div>
      )}

      {/* Add second wallet if only one connected */}
      {(evmConnected || solConnected) && !(evmConnected && solConnected) && (
        <button
          onClick={() => setShowConnectModal(true)}
          title={evmConnected ? 'Tambah Solana wallet' : 'Tambah EVM wallet'}
          className="flex items-center gap-1 px-2 py-2 bg-[#0f0f2a] border border-[#1e1e48] hover:border-brand-600/40 rounded-xl text-gray-500 hover:text-white transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          <span className="hidden sm:inline text-xs">{evmConnected ? 'SOL' : 'EVM'}</span>
        </button>
      )}
    </div>
  );
}

interface DropdownProps {
  label: string; address: string; network: string; networkColor: string;
  copied: boolean; onCopy: () => void; onDisconnect: () => void; onClose: () => void;
  extra?: React.ReactNode;
}

function WalletDropdown(p: DropdownProps) {
  return (
    <div className="absolute right-0 top-full mt-2 w-64 bg-[#0c0c22] border border-[#1e1e48] rounded-xl shadow-2xl z-50 overflow-hidden">
      <div className="px-4 py-3 border-b border-[#1e1e48]">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-gray-500 text-xs">{p.label}</span>
          <span className={clsx('text-xs', p.networkColor)}>{p.network}</span>
        </div>
        <p className="text-white text-xs font-mono break-all leading-relaxed">{p.address}</p>
      </div>
      {p.extra}
      <div className="p-1">
        <button onClick={p.onCopy} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors">
          {p.copied ? <CheckCircle2 className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
          {p.copied ? 'Disalin!' : 'Salin Alamat'}
        </button>
        <button onClick={p.onDisconnect} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/5 rounded-lg transition-colors">
          <LogOut className="w-4 h-4" /> Putuskan
        </button>
      </div>
    </div>
  );
}
