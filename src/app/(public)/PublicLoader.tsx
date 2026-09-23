'use client';

/**
 * PublicLoader — route-aware mount for <KiprampLoader /> (public routes).
 *
 * Visible on initial load and on every pathname change. Hides only when
 * BOTH are true: the loader's own animation reached its brand frame AND
 * the destination page settled (first paint committed + fonts ready).
 * Tiny state-only transitions (query/hash, same-page anchors) are ignored.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { AnimatePresence } from 'framer-motion';
import { KiprampLoader } from '@/components/ui/KiprampLoader';

export function PublicLoader() {
  const pathname = usePathname();
  const [runId, setRunId] = useState(0);
  const [active, setActive] = useState(true);
  const [settled, setSettled] = useState(false);
  // Navigasi diklik tapi halaman tujuan belum commit (compile berjalan):
  // loader dilarang keluar selama pending, seberapa pun animasinya.
  const [pending, setPending] = useState(false);
  const first = useRef(true);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startRun = useCallback(() => {
    setSettled(false);
    setActive(true);
    setRunId((k) => k + 1);
  }, []);

  // Klik menu/link internal → tampilkan loader SEJAK KLIK (menutupi compile
  // on-demand + halaman lama), bukan menunggu navigasi commit.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      let url: URL;
      try {
        url = new URL(anchor.href, window.location.origin);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return; // eksternal: biarkan browser
      if (url.pathname === window.location.pathname && url.search === window.location.search) return; // hash / halaman sama
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
      setPending(true);
      // Failsafe: navigasi batal/gagal tanpa commit → jangan kunci selamanya.
      // Batas longgar (cold compile halaman wallet bisa >60 detik di dev).
      pendingTimer.current = setTimeout(() => setPending(false), 120000);
      startRun();
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [startRun]);

  // Navigasi commit (termasuk router.push programatik): jika loader sudah
  // tampil sejak klik, lanjutkan animasi yang sama (tanpa restart); jika
  // belum, mulai run baru.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    // Halaman tujuan commit (compile selesai, render dimulai): buka kunci.
    if (pendingTimer.current) {
      clearTimeout(pendingTimer.current);
      pendingTimer.current = null;
    }
    setPending(false);
    setSettled(false);
    setActive((was) => {
      if (!was) setRunId((k) => k + 1);
      return true;
    });
  }, [pathname]);

  // Settled = paint committed + fonts ready (approximation of "fully rendered").
  useEffect(() => {
    setSettled(false);
    let cancelled = false;
    const t = setTimeout(() => {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (cancelled) return;
          const fonts = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts;
          if (fonts?.ready) {
            fonts.ready.then(() => {
              if (!cancelled) setSettled(true);
            });
          } else {
            setSettled(true);
          }
        }),
      );
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, runId]);

  return (
    <AnimatePresence>
      {active && (
        <KiprampLoader key={runId} ready={settled && !pending} onExited={() => setActive(false)} />
      )}
    </AnimatePresence>
  );
}
