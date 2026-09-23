'use client';

/**
 * SwapDirectionButton — circular glass flip button between pay/receive.
 * Rotates 180° + scales on every direction change (framer-motion spring).
 */

import { motion } from 'framer-motion';
import { ArrowUpDown } from 'lucide-react';

export function SwapDirectionButton({
  direction,
  onFlip,
  disabled,
}: {
  direction: 'BUY' | 'SELL';
  onFlip: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="relative flex justify-center -my-3 z-10">
      <motion.button
        type="button"
        onClick={onFlip}
        disabled={disabled}
        aria-label={direction === 'BUY' ? 'Ubah ke Sell (Crypto ke IDR)' : 'Ubah ke Top Up (IDR ke Crypto)'}
        title="Balik arah"
        initial={false}
        animate={{ rotate: direction === 'BUY' ? 0 : 180 }}
        transition={{ type: 'spring', stiffness: 400, damping: 22, duration: 0.2 }}
        whileHover={disabled ? undefined : { scale: 1.08, y: -2 }}
        whileTap={disabled ? undefined : { scale: 0.94 }}
        className="w-12 h-12 rounded-full glass flex items-center justify-center
          border border-[#D4B78F]/30 bg-[#141416]/90 backdrop-blur-xl
          shadow-[0_0_24px_rgba(212,183,143,0.25)] hover:shadow-[0_0_32px_rgba(212,183,143,0.4)]
          transition-shadow duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <ArrowUpDown className="w-5 h-5 text-[#D4B78F]" aria-hidden />
      </motion.button>
    </div>
  );
}
