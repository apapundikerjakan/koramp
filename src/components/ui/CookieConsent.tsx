'use client';

/**
 * CookieConsent — first-visit notice (privacy + cookies).
 * Shows once until the visitor chooses; choice persists in localStorage.
 * No account system, no tracking — the stored value is only 'accepted'/'declined'.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Cookie } from 'lucide-react';

const KEY = 'kipramp_cookie_consent';

export function CookieConsent() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (!window.localStorage.getItem(KEY)) setShow(true);
    } catch {
      setShow(true);
    }
  }, []);

  const choose = (v: 'accepted' | 'declined') => {
    try {
      window.localStorage.setItem(KEY, v);
    } catch {
      /* storage unavailable — session-only */
    }
    setShow(false);
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          role="dialog"
          aria-live="polite"
          aria-label="Persetujuan cookie"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:max-w-sm z-[90]"
        >
          <div className="bg-surface-2 border border-line rounded-2xl shadow-2xl p-5">
            <div className="flex items-center gap-2.5 mb-2">
              <div className="w-8 h-8 bg-brand-600/20 rounded-xl flex items-center justify-center flex-shrink-0">
                <Cookie className="w-4 h-4 text-brand-400" aria-hidden />
              </div>
              <p className="text-white font-bold text-sm">Privasi & Cookie</p>
            </div>
            <p className="text-gray-400 text-xs leading-relaxed mb-1">
              KORAMP memakai cookie teknis agar situs berfungsi (pilihan ini, preferensi grafik)
              dan tidak membuat akun atau melacak identitas Anda.
            </p>
            <Link href="/privacy" className="text-brand-400 hover:text-brand-300 text-xs font-semibold transition-colors">
              Baca Kebijakan Privasi →
            </Link>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => choose('declined')}
                className="flex-1 py-2.5 text-xs font-semibold rounded-xl border border-line-subtle text-gray-300 hover:text-white hover:border-line-strong transition-colors"
              >
                Tolak
              </button>
              <button
                onClick={() => choose('accepted')}
                className="flex-1 py-2.5 text-xs font-bold rounded-xl bg-[#D4B78F] hover:bg-[#E2C9A5] text-[#111111] transition-colors"
              >
                Terima
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
