'use client';

import Link from 'next/link';
import { useWallet } from '@/contexts/WalletContext';
import { ArrowRight, ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import { BeamBorder, PulseRings } from '@/components/ui/motion';

/**
 * Client islands for homepage CTAs — only these need wallet state.
 * Primary CTA uses beam border + pulse ring (Beam §4.1).
 */
export function HeroCta() {
  const { isConnected, openEvmModal } = useWallet();
  if (!isConnected) {
    return (
      <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
        <BeamBorder active radius="rounded-xl" className="relative">
          <PulseRings className="rounded-xl" />
          <button
            onClick={openEvmModal}
            className="btn-primary relative flex items-center gap-2 text-base py-3.5 px-8 border-0"
          >
            Hubungkan Wallet
            <ArrowRight className="w-4 h-4" aria-hidden />
          </button>
        </BeamBorder>
        <div className="flex items-center gap-3">
          <Link href="/topup" className="btn-secondary flex items-center gap-2 text-sm py-3 px-6">
            <ArrowUpRight className="w-4 h-4 text-brand-400" aria-hidden />
            Top Up
          </Link>
          <Link href="/sell" className="btn-secondary flex items-center gap-2 text-sm py-3 px-6">
            <ArrowDownLeft className="w-4 h-4 text-green-400" aria-hidden />
            Sell
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col sm:flex-row gap-3 justify-center">
      <BeamBorder active radius="rounded-xl">
        <Link href="/topup" className="btn-primary flex items-center gap-2 text-base py-3.5 px-8 border-0">
          <ArrowUpRight className="w-4 h-4" aria-hidden />
          Top Up Crypto
        </Link>
      </BeamBorder>
      <Link href="/sell" className="btn-secondary flex items-center gap-2 text-base py-3.5 px-8">
        <ArrowDownLeft className="w-4 h-4 text-green-400" aria-hidden />
        Sell Crypto
      </Link>
    </div>
  );
}

export function BottomCta() {
  const { isConnected, openEvmModal } = useWallet();
  if (isConnected) {
    return (
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <Link href="/topup" className="btn-primary flex items-center gap-2">
          <ArrowUpRight className="w-4 h-4" aria-hidden /> Top Up Crypto
        </Link>
        <Link href="/sell" className="btn-secondary flex items-center gap-2">
          <ArrowDownLeft className="w-4 h-4 text-green-400" aria-hidden /> Sell Crypto
        </Link>
      </div>
    );
  }
  return (
    <BeamBorder active radius="rounded-xl" className="inline-block">
      <button onClick={openEvmModal} className="btn-primary flex items-center gap-2 mx-auto text-base py-3.5 px-8 border-0">
        Hubungkan Wallet <ArrowRight className="w-4 h-4" aria-hidden />
      </button>
    </BeamBorder>
  );
}
