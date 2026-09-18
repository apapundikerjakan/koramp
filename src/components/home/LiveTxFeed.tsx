'use client';

/**
 * LiveTxFeed — "buku kas" loket: hairline ledger rows, tabular numerals.
 * Data contoh hardcoded sesuai spek (bukan transaksi sungguhan).
 * Interval 3.5s, 4 baris visible, spring enter dari bawah, fade exit.
 */

import { useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { formatIDR, formatCrypto } from '@/lib/format';
import { TokenIcon, type TokenSymbol } from '@/components/ui/TokenIcon';

interface MockTx {
  type: 'topup' | 'sell';
  asset: TokenSymbol;
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

  const rows: (MockTx & { key: number })[] = Array.from({ length: VISIBLE }, (_, i) => {
    const idx = (offset + i) % MOCK_TRANSACTIONS.length;
    return { ...MOCK_TRANSACTIONS[idx], key: offset + i };
  });

  return (
    <div className="border border-line rounded-2xl bg-surface-1 overflow-hidden" aria-label="Arus loket terkini (contoh)">
      <AnimatePresence initial={false} mode="popLayout">
        {rows.map((t) => (
          <motion.div
            key={t.key}
            layout={!reduce}
            initial={reduce ? false : { y: '60%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={reduce ? undefined : { opacity: 0, transition: { duration: 0.2 } }}
            transition={{ type: 'spring', stiffness: 260, damping: 28 }}
            className="rate-row !py-2.5"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span
                className={t.status === 'done' ? 'w-1.5 h-1.5 rounded-full bg-[#4CAF6D] flex-shrink-0' : 'w-1.5 h-1.5 rounded-full bg-[#D9A441] animate-pulse flex-shrink-0'}
                aria-hidden
              />
              <TokenIcon symbol={t.asset} size={18} />
              <div className="min-w-0">
                <p className="text-ink-primary text-sm font-medium leading-tight truncate">
                  {t.type === 'topup' ? 'Top up' : 'Jual'} {t.asset}
                  <span className="text-ink-muted font-mono text-xs ml-2">{t.address}</span>
                </p>
                <p className="text-ink-muted text-xs">{t.network} · {t.ago}</p>
              </div>
            </div>
            <p className="tnum text-ink-primary text-sm whitespace-nowrap">
              {formatIDR(t.idr)} <span className="text-ink-muted">→</span> {formatCrypto(t.amount)} {t.asset}
            </p>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
