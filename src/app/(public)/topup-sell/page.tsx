'use client';

/**
 * /topup-sell — THE unified Top Up / Sell swap experience.
 * Single route, single nav entry. Direction is controlled only by the
 * widget's center swap button. Legacy /topup and /sell routes remain
 * available for direct access and query-prefill compatibility.
 */

import { Navbar } from '@/components/layout/Navbar';
import { SwapWidget } from '@/components/swap/SwapWidget';
import { ArrowRightLeft } from 'lucide-react';

export default function TopUpSellPage() {
  return (
    <div className="h-dvh flex flex-col overflow-hidden bg-base">
      <Navbar />
      <div className="flex-1 min-h-0 mx-auto w-full max-w-[1600px] px-4 sm:px-6 py-3 sm:py-4 flex flex-col">
        <div className="mb-3 flex-shrink-0">
          <div className="flex items-center gap-3 mb-0.5">
            <div className="w-8 h-8 bg-brand-600/20 rounded-xl flex items-center justify-center flex-shrink-0">
              <ArrowRightLeft className="w-4 h-4 text-brand-400" />
            </div>
            <h1 className="text-xl font-semibold tracking-[-0.02em] text-white">Top Up/Sell</h1>
          </div>
          <p className="text-gray-500 text-xs sm:pl-11 hidden sm:block">
            IDR ⇄ Crypto dalam satu widget. Balik arah instan lewat tombol swap di tengah.
          </p>
        </div>

        <div className="flex-1 min-h-0">
          <SwapWidget />
        </div>
      </div>
    </div>
  );
}
