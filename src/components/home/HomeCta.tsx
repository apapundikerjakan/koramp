'use client';

import Link from 'next/link';
import { useWallet } from '@/contexts/WalletContext';
import { ArrowRight, ArrowUpRight, ArrowDownLeft } from 'lucide-react';

/** Client islands for homepage CTAs (P24) — only these need wallet state. */
export function HeroCta() {
  const { isConnected, setShowConnectModal } = useWallet();
  if (!isConnected) {
    return (
      <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
        <button
          onClick={() => setShowConnectModal(true)}
          className="btn-primary flex items-center gap-2 text-base py-3.5 px-8"
        >
          Hubungkan Wallet
          <ArrowRight className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-3">
          <Link href="/topup" className="btn-secondary flex items-center gap-2 text-sm py-3 px-6">
            <ArrowUpRight className="w-4 h-4 text-brand-400" />
            Top Up
          </Link>
          <Link href="/sell" className="btn-secondary flex items-center gap-2 text-sm py-3 px-6">
            <ArrowDownLeft className="w-4 h-4 text-green-400" />
            Sell
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-3 justify-center">
      <Link href="/topup" className="btn-primary flex items-center gap-2 text-base py-3.5 px-8">
        <ArrowUpRight className="w-4 h-4" />
        Top Up Crypto
      </Link>
      <Link href="/sell" className="btn-secondary flex items-center gap-2 text-base py-3.5 px-8">
        <ArrowDownLeft className="w-4 h-4 text-green-400" />
        Sell Crypto
      </Link>
    </div>
  );
}

export function BottomCta() {
  const { isConnected, setShowConnectModal } = useWallet();
  if (isConnected) {
    return (
      <div className="flex gap-3 justify-center">
        <Link href="/topup" className="btn-primary flex items-center gap-2">
          <ArrowUpRight className="w-4 h-4" /> Top Up Crypto
        </Link>
        <Link href="/sell" className="btn-secondary flex items-center gap-2">
          <ArrowDownLeft className="w-4 h-4 text-green-400" /> Sell Crypto
        </Link>
      </div>
    );
  }
  return (
    <button onClick={() => setShowConnectModal(true)} className="btn-primary flex items-center gap-2 mx-auto text-base py-3.5 px-8">
      Hubungkan Wallet <ArrowRight className="w-4 h-4" />
    </button>
  );
}
