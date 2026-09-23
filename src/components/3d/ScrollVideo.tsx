'use client';

import { useEffect, useRef, useState } from 'react';

interface ScrollVideoProps {
  src: string;
  /** File reversed (frame dibalik) — dimuat lazy saat pertama scroll naik. */
  srcRev?: string;
  poster?: string;
  /** Dilafalkan screen reader (video + canvas aria-hidden). */
  label: string;
  className?: string;
}

type RVFCVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => void;
};

const FWD = 0;
const REV = 1;

/**
 * Video scrollytelling dua arah yang ringan:
 *
 * - Scroll bawah → file normal play native (rate 1–4x). Scroll atas →
 *   file reversed play native. Sama mulus, karena keduanya maju-native.
 * - Ringan: file reversed TIDAK dimuat sampai user pertama kali scroll
 *   naik (lazy). Satu decoder aktif dalam satu waktu; loop lukis tunggal.
 * - Anti-thrash: ganti arah butuh 2 tick beruntun (histeresis); tidak ada
 *   play/seek saat video masih seeking; canvas DPR 1.
 */
export function ScrollVideo({ src, srcRev, poster, label, className }: ScrollVideoProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const fwdRef = useRef<RVFCVideo | null>(null);
  const revRef = useRef<RVFCVideo | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [active, setActive] = useState(false);
  const activeRef = useRef(false);
  // File reversed dipasang hanya setelah ada niat scroll naik.
  const [revOn, setRevOn] = useState(false);
  const revOnRef = useRef(false);

  useEffect(() => {
    const wrap = wrapRef.current;
    const fwd = fwdRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !fwd || !canvas) return;

    let reduce = false;
    let coarse = false;
    try {
      reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      coarse = window.matchMedia('(pointer: coarse)').matches;
    } catch {
      /* ignore */
    }
    if (reduce) return; // poster statis, tanpa listener

    const rev = () => revRef.current;
    const hasRev = () => revOnRef.current && !!srcRev && !!rev();
    const SEEK_T = coarse ? 1 / 30 : 1 / 60;
    const SNAP_T = 0.04;
    const target = { v: 0 };
    const cur = { v: 0 }; // basis waktu file normal (detik)
    const mode = { v: FWD as 0 | 1 };
    const dirCount = { v: 0 }; // histeresis arah
    let raf = 0;
    let running = false;
    let duration = 0;
    let destroyed = false;

    const videos = () => {
      const r = rev();
      return r ? [fwd, r] : [fwd];
    };

    const resize = () => {
      // Canvas 1:1 piksel CSS — cukup untuk frame ±594px, separuh biaya paint.
      const r = wrap.getBoundingClientRect();
      const w = Math.max(2, Math.round(r.width));
      const h = Math.max(2, Math.round((r.width * 9) / 16));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    };

    const bufferedEnd = (v: HTMLVideoElement) => {
      try {
        const b = v.buffered;
        if (!b || b.length === 0) return 0;
        return b.end(b.length - 1);
      } catch {
        return 0;
      }
    };

    const activeVideo = (): RVFCVideo => (mode.v === REV && hasRev() ? rev()! : fwd);

    const paint = () => {
      try {
        const v = activeVideo();
        if (v.readyState >= 2) {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            if (!activeRef.current) {
              activeRef.current = true;
              setActive(true);
            }
          }
        }
      } catch {
        /* ignore */
      }
    };

    // Satu loop lukis: hanya video aktif yang mendaftar ulang.
    const onFrame = (v: RVFCVideo) => {
      if (destroyed) return;
      if (v !== activeVideo()) return; // nonaktif → berhenti, tanpa daftar ulang
      paint();
      try {
        v.requestVideoFrameCallback?.(() => onFrame(v));
      } catch {
        /* ignore */
      }
    };
    const armFrame = () => {
      try {
        activeVideo().requestVideoFrameCallback?.((() => {
          const v = activeVideo();
          return () => onFrame(v);
        })());
      } catch {
        /* fallback: paint() di tick */
      }
    };

    const pauseAll = () => {
      for (const v of videos()) {
        try {
          if (!v.paused) v.pause();
        } catch {
          /* ignore */
        }
      }
    };

    const setRate = (v: HTMLVideoElement, r: number) => {
      const c = Math.max(0.5, Math.min(4, r));
      try {
        if (Math.abs((v.playbackRate || 1) - c) > 0.25) v.playbackRate = c;
      } catch {
        /* ignore */
      }
    };

    const activeTime = () => {
      if (mode.v === REV && hasRev()) {
        const r = rev()!;
        return duration - r.currentTime;
      }
      return fwd.currentTime;
    };

    const switchTo = (m: 0 | 1) => {
      if (mode.v === m || (m === REV && !hasRev())) return;
      const r = rev()!;
      try {
        if (m === FWD) fwd.currentTime = Math.max(0, Math.min(duration, duration - r.currentTime));
        else r.currentTime = Math.max(0, Math.min(duration, duration - fwd.currentTime));
      } catch {
        /* ignore */
      }
      mode.v = m;
      dirCount.v = 0;
      armFrame();
    };

    // Minta arah; dieksekusi hanya setelah 2 tick beruntun (anti flip-flop).
    const wantDir = (m: 0 | 1) => {
      if (mode.v === m) {
        dirCount.v = 0;
        return;
      }
      dirCount.v += 1;
      if (dirCount.v >= 2) switchTo(m);
    };

    const playActive = (rate: number): boolean => {
      const v = activeVideo();
      if (v.seeking) return false; // masih decode seek → jangan timpa
      const end = bufferedEnd(v);
      if (end > 0 && v.currentTime + 0.15 >= end && end < duration - 0.25) return false;
      setRate(v, rate);
      if (v.paused) {
        try {
          const p = v.play() as unknown as Promise<void> | undefined;
          if (p && typeof p.catch === 'function') p.catch(() => {});
        } catch {
          return false;
        }
      }
      return true;
    };

    const seekActive = (t: number) => {
      const v = activeVideo();
      if (v.seeking) return;
      const time = Math.max(0, Math.min(duration || 0, t));
      try {
        const pos = mode.v === REV && hasRev() ? duration - time : time;
        if (Math.abs(v.currentTime - pos) > SEEK_T) v.currentTime = pos;
      } catch {
        /* ignore */
      }
    };

    const tick = () => {
      if (destroyed) {
        running = false;
        raf = 0;
        return;
      }
      if (document.hidden) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const delta = target.v - cur.v;

      if (Math.abs(delta) <= SNAP_T || duration <= 0) {
        if (duration > 0) {
          pauseAll();
          dirCount.v = 0;
          seekActive(target.v);
          cur.v = target.v;
          paint();
        }
        running = false;
        raf = 0;
        return;
      }

      if (delta > 0) {
        wantDir(FWD);
        cur.v = activeTime();
        if (target.v - cur.v > SNAP_T) {
          if (!playActive(1 + (target.v - cur.v) * 1.2)) {
            pauseAll();
            seekActive(target.v - SNAP_T);
            cur.v = activeTime();
          } else {
            cur.v = activeTime();
          }
        }
      } else if (hasRev()) {
        wantDir(REV);
        cur.v = activeTime();
        if (cur.v - target.v > SNAP_T) {
          if (!playActive(1 + (cur.v - target.v) * 1.2)) {
            pauseAll();
            seekActive(target.v + SNAP_T);
            cur.v = activeTime();
          } else {
            cur.v = activeTime();
          }
        }
      } else {
        // Reversed belum dimuat → minta muat, sementara seek biasa.
        if (srcRev && !revOnRef.current) {
          revOnRef.current = true;
          setRevOn(true);
        }
        pauseAll();
        cur.v += delta * 0.35;
        seekActive(cur.v);
      }

      paint();
      raf = requestAnimationFrame(tick);
    };
    const kick = () => {
      if (!running && !destroyed) {
        running = true;
        raf = requestAnimationFrame(tick);
      }
    };

    const update = () => {
      if (duration <= 0) return;
      const track = wrap.closest('[data-scrub-track]') as HTMLElement | null;
      const vh = window.innerHeight || 1;
      let p: number;
      if (track) {
        const rect = track.getBoundingClientRect();
        const total = rect.height - vh;
        p = total > 0 ? -rect.top / total : 1;
      } else {
        // Non-pinned (track lebih pendek dari viewport): scrub mengikuti
        // traversal elemen melintasi viewport — 0 saat masuk dari bawah,
        // 1 saat keluar di atas. Sebelumnya fallback selalu p=1 sehingga
        // video langsung lompat ke frame akhir dan diam.
        const rect = wrap.getBoundingClientRect();
        const total = vh + rect.height;
        p = total > 0 ? (vh - rect.top) / total : 1;
      }
      target.v = Math.max(0, Math.min(1, p)) * duration;
      kick();
    };

    const onMeta = () => {
      if (Number.isFinite(fwd.duration) && fwd.duration > 0) {
        duration = fwd.duration;
        resize();
        try {
          fwd.currentTime = 0;
        } catch {
          /* ignore */
        }
        paint();
        update();
      }
    };

    const onEnded = () => kick();

    resize();
    if (fwd.readyState >= 1) onMeta();
    else fwd.addEventListener('loadedmetadata', onMeta, { once: true });
    armFrame();
    fwd.addEventListener('canplay', kick);
    fwd.addEventListener('progress', kick);
    fwd.addEventListener('ended', onEnded);
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', () => {
      resize();
      update();
    });
    update();

    return () => {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      pauseAll();
      fwd.removeEventListener('loadedmetadata', onMeta);
      fwd.removeEventListener('canplay', kick);
      fwd.removeEventListener('progress', kick);
      fwd.removeEventListener('ended', onEnded);
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
    // NOTE: revOn sengaja TIDAK masuk dep —rev video diakses via ref saat
    // mount; effect rerun akan me-reset currentTime ke 0 (lompatan).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, srcRev]);

  return (
    <div
      ref={wrapRef}
      role="img"
      aria-label={label}
      className={
        'relative aspect-[16/9] overflow-hidden rounded-xl border border-[#232326] bg-[#0B0B0D]' +
        (className ? ' ' + className : '')
      }
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={poster}
        alt=""
        aria-hidden
        loading="lazy"
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover"
        draggable={false}
      />
      <canvas
        ref={canvasRef}
        aria-hidden
        className="absolute inset-0 h-full w-full object-cover transition-opacity duration-500"
        style={{ opacity: active ? 1 : 0 }}
      />
      <video
        ref={fwdRef}
        className="absolute opacity-0 pointer-events-none w-px h-px"
        src={src}
        muted
        playsInline
        preload="auto"
        disablePictureInPicture
        aria-hidden
      />
      {srcRev && revOn ? (
        <video
          ref={revRef}
          className="absolute opacity-0 pointer-events-none w-px h-px"
          src={srcRev}
          muted
          playsInline
          preload="auto"
          disablePictureInPicture
          aria-hidden
        />
      ) : null}
    </div>
  );
}
