'use client';

/**
 * Live Transaction Feed — prompt UI §4.10.
 * Stream kartu transaksi bergulir di hero (data contoh hardcoded sesuai spec).
 * Interval 3.5s, 4 kartu visible, spring enter dari bawah, fade exit.
 */

import { useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import clsx from 'clsx';
import { formatIDR } from '@/lib/format';

interface MockTx {
  type: 'topup' | 'sell';
  asset: 'SOL' | 'ETH' | 'BNB';
  address: string;
  idr: number;
  amount: number;
  network: string;
  status: 'done' | 'processing';
  ago: string;
}

const MOCK_TRANSACTIONS: MockTx[] = [
  { type: 'topup', asset: 'SOL', address: '9xKP...7bMn', idr: 500_000, amount: 0.177, network: 'Solana', status: 'done', ago: '2 menit lalu' },
  { type: 'sell', asset: 'ETH', address: '0x742d...F5c2', idr: 800_200, amount: 0.002, network: 'Base', status: 'done', ago: '5 menit lalu' },
  { type: 'topup', asset: 'BNB', address: '0xA3f1...9Cc0', idr: 200_000, amount: 0.012, network: 'BSC', status: 'processing', ago: 'baru saja' },
  { type: 'topup', asset: 'SOL', address: '7mNx...3pQr', idr: 90_000, amount: 0.031, network: 'Solana', status: 'done', ago: '8 menit lalu' },
  { type: 'sell', asset: 'ETH', address: '0xB92e...4Dc1', idr: 80_200, amount: 0.002, network: 'Base', status: 'done', ago: '12 menit lalu' },
];

const ASSET_STYLE: Record<MockTx['asset'], { icon: string; color: string }> = {
  SOL: { icon: '◎', color: 'text-purple-400' },
  ETH: { icon: 'Ξ', color: 'text-blue-400' },
  BNB: { icon: '⬡', color: 'text-yellow-400' },
};

const VISIBLE = 4;
const INTERVAL_MS = 3500;

export function LiveTxFeed() {
  const reduce = useReducedMotion();
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setOffset((o) => o + 1), INTERVAL_MS);
    return () => clearInterval(id);
  }, [reduce]);

  const cards: (MockTx & { key: number })[] = Array.from({ length: VISIBLE }, (_, i) => {
    const idx = (offset + i) % MOCK_TRANSACTIONS.length;
    return { ...MOCK_TRANSACTIONS[idx], key: offset + i };
  });

  return (
    <div className="relative" aria-label="Transaksi terbaru (contoh)">
      <div className="space-y-3">
        <AnimatePresence initial={false} mode="popLayout">
          {cards.map((t) => (
            <motion.div
              key={t.key}
              layout={!reduce}
              initial={reduce ? false : { y: '100%', opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={reduce ? undefined : { opacity: 0, transition: { duration: 0.2 } }}
              transition={{ type: 'spring', stiffness: 260, damping: 28 }}
              className="bg-surface-1/90 backdrop-blur border border-line-subtle rounded-2xl p-4 text-left shadow-xl shadow-black/20"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-white text-sm font-semibold">
                  <span className={clsx('mr-1.5', ASSET_STYLE[t.asset].color)}>{ASSET_STYLE[t.asset].icon}</span>
                  {t.type === 'topup' ? 'Top Up' : 'Sell'} {t.asset}
                </span>
                {t.status === 'done' ? (
                  <span className="badge-success">✓ Selesai</span>
                ) : (
                  <span className="badge-warning">⟳ Proses</span>
                )}
              </div>
              <p className="text-gray-500 font-mono text-xs">{t.address}</p>
              <p className="text-gray-300 text-sm mt-1">
                {formatIDR(t.idr)} <span className="text-gray-600">→</span>{' '}
                <span className={ASSET_STYLE[t.asset].color}>≈ {t.amount} {t.asset}</span>
              </p>
              <p className="text-gray-600 text-xs mt-1">{t.network} Network · {t.ago}</p>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <div className="pointer-events-none absolute inset-x-0 -bottom-2 h-10 bg-gradient-to-t from-base to-transparent" aria-hidden />
    </div>
  );
}

/** Asset icons orbit (Animata) — floating SOL/ETH/BNB with glow halos. */
export function OrbitIcons() {
  const reduce = useReducedMotion();
  const items = [
    { icon: '◎', color: 'text-purple-400', border: 'border-purple-500/30', glow: 'bg-purple-500/20', pos: 'left-[8%] top-[12%]', d: '0s' },
    { icon: 'Ξ', color: 'text-blue-400', border: 'border-blue-500/30', glow: 'bg-blue-500/20', pos: 'right-[10%] top-[20%]', d: '1.2s' },
    { icon: '⬡', color: 'text-yellow-400', border: 'border-yellow-500/30', glow: 'bg-yellow-500/20', pos: 'left-[14%] bottom-[14%]', d: '2.1s' },
  ];
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden>
      {items.map((it) => (
        <div key={it.icon} className={clsx('absolute', it.pos)}>
          <div className={clsx('absolute inset-0 blur-2xl rounded-full scale-150', it.glow)} />
          <div
            className={clsx(
              'relative w-14 h-14 rounded-2xl glass border flex items-center justify-center text-2xl font-black',
              it.border,
              it.color,
              !reduce && 'animate-float-y',
            )}
            style={reduce ? undefined : { animationDelay: it.d }}
          >
            {it.icon}
          </div>
        </div>
      ))}
    </div>
  );
}
