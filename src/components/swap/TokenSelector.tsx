'use client';

/**
 * TokenSelector — swap-style crypto picker (SOL/ETH/BNB).
 * Button shows current token; click opens modal. Reuses TokenIcon and the
 * per-asset glow identities from AssetCard. IDR is fixed (not selectable).
 */

import { useEffect, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Check } from 'lucide-react';
import clsx from 'clsx';
import { TokenIcon } from '@/components/ui/TokenIcon';
import { ASSET_INFO, type Asset } from '@/components/ui/AssetCard';

function RpMark({ size = 26 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="rounded-full bg-[#D4B78F]/10 border border-[#D4B78F]/30 text-[#D4B78F] font-bold flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      Rp
    </span>
  );
}

function CurrencyModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        className="relative w-full max-w-xs bg-surface-2 border border-line rounded-2xl shadow-2xl overflow-hidden"
      >
        <p className="px-5 pt-4 pb-3 text-white font-bold text-sm">{title}</p>
        <div className="px-3 pb-4 space-y-2">{children}</div>
      </motion.div>
    </div>
  );
}

const ORDER: Asset[] = ['SOL', 'ETH', 'BNB'];

export function TokenSelector({
  value,
  onChange,
  open,
  onOpenChange,
}: {
  value: Asset;
  onChange: (a: Asset) => void;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onOpenChange]);

  const info = ASSET_INFO[value];

  return (
    <>
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Pilih token, saat ini ${value}`}
        className={clsx(
          'flex items-center gap-2 pl-1.5 pr-2.5 py-1.5 rounded-xl border transition-all asset-lift',
          info.glow,
          'bg-white/[0.03] border-line-subtle hover:border-line-strong',
        )}
      >
        <TokenIcon symbol={value} size={26} />
        <span className="text-left leading-none">
          <span className={clsx('block font-bold text-base', info.color)}>{value}</span>
          <span className="block text-gray-500 text-[11px] mt-0.5">{info.network}</span>
        </span>
        <ChevronDown className="w-4 h-4 text-gray-500" aria-hidden />
      </button>

      <AnimatePresence>
        {open && (
          <CurrencyModalShell title="Choose Token" onClose={() => onOpenChange(false)}>
            {ORDER.map((a) => {
              const ai = ASSET_INFO[a];
              const selected = a === value;
              return (
                <button
                  key={a}
                  type="button"
                  onClick={() => {
                    onChange(a);
                    onOpenChange(false);
                  }}
                  aria-pressed={selected}
                  className={clsx(
                    'w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all asset-lift',
                    ai.glow,
                    selected
                      ? 'selected border-brand-500 bg-brand-600/10'
                      : 'border-line-subtle hover:bg-surface-3',
                  )}
                >
                  <TokenIcon symbol={a} size={28} />
                  <span className="flex-1 min-w-0 leading-none">
                    <span className={clsx('block font-bold text-sm', ai.color)}>{a}</span>
                    <span className="block text-gray-500 text-xs mt-1">{ai.network}</span>
                  </span>
                  {selected && <Check className="w-4 h-4 text-brand-400 flex-shrink-0" aria-hidden />}
                </button>
              );
            })}
          </CurrencyModalShell>
        )}
      </AnimatePresence>
    </>
  );
}

/**
 * IdrSelector — symmetrical fiat picker. IDR is the only fiat, so the modal
 * lists a single option; selecting closes immediately, like TokenSelector.
 */
export function IdrSelector({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onOpenChange]);

  return (
    <>
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Pilih mata uang, saat ini IDR"
        className="flex items-center gap-2 pl-1.5 pr-2.5 py-1.5 rounded-xl border transition-all bg-white/[0.03] border-line-subtle hover:border-line-strong"
      >
        <RpMark size={26} />
        <span className="text-left leading-none">
          <span className="block font-bold text-base text-[#D4B78F]">IDR</span>
          <span className="block text-gray-500 text-[11px] mt-0.5">Indonesian Rupiah</span>
        </span>
        <ChevronDown className="w-4 h-4 text-gray-500" aria-hidden />
      </button>

      <AnimatePresence>
        {open && (
          <CurrencyModalShell title="Choose Currency" onClose={() => onOpenChange(false)}>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-pressed
              className="w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all selected border-brand-500 bg-brand-600/10"
            >
              <RpMark size={28} />
              <span className="flex-1 min-w-0 leading-none">
                <span className="block font-bold text-sm text-[#D4B78F]">IDR</span>
                <span className="block text-gray-500 text-xs mt-1">Indonesian Rupiah</span>
              </span>
              <Check className="w-4 h-4 text-brand-400 flex-shrink-0" aria-hidden />
            </button>
          </CurrencyModalShell>
        )}
      </AnimatePresence>
    </>
  );
}
