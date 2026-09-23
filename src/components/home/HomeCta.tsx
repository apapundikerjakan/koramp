'use client';

import Link from 'next/link';
import { useWallet } from '@/contexts/WalletContext';
import { ArrowRight, ArrowRightLeft } from 'lucide-react';
import { BeamBorder } from '@/components/ui/motion';

/**
 * Client islands for homepage CTAs — only these need wallet state.
 * Primary CTA uses beam border (Beam §4.1).
 */
export function BottomCta() {
  const { isConnected, openEvmModal } = useWallet();
  if (isConnected) {
    return (
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <Link href="/topup-sell" className="btn-primary flex items-center gap-2">
          <ArrowRightLeft className="w-4 h-4" aria-hidden /> Top Up/Sell Crypto
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
