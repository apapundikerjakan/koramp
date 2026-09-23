'use client';

/*
 * WhyCards — scroll-driven stacked cards ("Kenapa pengguna memilih KORAMP").
 *
 * Struktur: <section> > div track (max-w-1200 + px-6) > div pin sticky
 * (top PIN_TOP) + div spacer sibling setinggi calc(5 x var(--step)).
 * Pin hanya berisi grid WhyCards (ramping, center vertikal presisi).
 * Progress manual dari posisi track.
 * Progress mentah p -> plateau (30%-70%) -> spring -> settle +-5% (ps):
 * card dominan SELALU integer persis. d = index - ps: 0 aktif (solid,
 * z teratas); d<0 surut ke atas-belakang; d>0 menunggu di bawah.
 * Fully reversible, kontinu, tanpa toggle per step.
 *
 * === TUNING CEPAT (satu tempat) ===
 * - PIN_TOP        : 'clamp(80px, 9vh, 96px)' (vertikal center, anti kosong).
 * - STEP           : via CSS var --step (160px mobile / 200px desktop);
 *   spacer = calc(5 * var(--step)). TUNE.step hanya dokumentasi.
 *   pin-top dinamis: center vertikal bila pin muat di viewport (fallback 88px).
 * - PLATEAU        : 0.3 -> transisi hanya di jendela 30%-70% per card.
 * - SNAP           : 0.05 -> dead-zone +-5% di sekitar integer (ps).
 * - Jarak y        : gapBehind 28px/lapis (ke atas), gapAhead 48px/lapis.
 * - Opacity knots  : belakang [[0,1],[1,0.35],[2,0.15],[2.6,0]];
 *   depan [[0,1],[1,0.3],[2,0.12],[2.6,0]] (|d|>=2.6 -> 0).
 * - Blur knots     : belakang [[0,0],[0.3,0.6],[1,6],[2,8]];
 *   depan [[0,0],[0.3,0.5],[1,4],[2,6]]; mobile x0.6. Blur <0.05 -> 'none'.
 * - Scale          : 1 - 0.03 x min(|d|, 2).
 * - Spring         : stiffness 260 / damping 32 / mass 0.6 /
 *   restDelta + restSpeed 0.0005 (settle bersih, tanpa ekor).
 * - willChange     : 'transform, opacity' saja.
 * - Aksen          : --k-accent #96794F (tanpa hijau di section ini).
 * ==================================
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  motion,
  useScroll,
  useSpring,
  useTransform,
  useMotionValue,
  useMotionValueEvent,
  type MotionValue,
} from 'framer-motion';
import { Zap, Shield, BadgePercent, Globe, Clock, Layers, type LucideIcon } from 'lucide-react';
import clsx from 'clsx';

const PLATEAU = 0.3;
const SNAP = 0.05;

interface Tune {
  step: number;
  gapBehind: number;
  gapAhead: number;
  blurFactor: number;
  opBehind: Array<[number, number]>;
  opAhead: Array<[number, number]>;
  blurBehind: Array<[number, number]>;
  blurAhead: Array<[number, number]>;
}

const TUNE_DESKTOP: Tune = {
  step: 200,
  gapBehind: 28,
  gapAhead: 48,
  blurFactor: 1,
  opBehind: [[0, 1], [1, 0.35], [2, 0.15], [2.6, 0]],
  opAhead: [[0, 1], [1, 0.3], [2, 0.12], [2.6, 0]],
  blurBehind: [[0, 0], [0.3, 0.6], [1, 6], [2, 8]],
  blurAhead: [[0, 0], [0.3, 0.5], [1, 4], [2, 6]],
};

const TUNE_MOBILE: Tune = {
  step: 160,
  gapBehind: 20,
  gapAhead: 36,
  blurFactor: 0.6,
  opBehind: [[0, 1], [1, 0.35], [2, 0.15], [2.6, 0]],
  opAhead: [[0, 1], [1, 0.3], [2, 0.12], [2.6, 0]],
  blurBehind: [[0, 0], [0.3, 0.6], [1, 6], [2, 8]],
  blurAhead: [[0, 0], [0.3, 0.5], [1, 4], [2, 6]],
};

const WHY: Array<{ icon: LucideIcon; title: string; desc: string }> = [
  { icon: Zap, title: 'Finalitas IDR Instan', desc: 'Dana settle dalam hitungan menit. Tanpa delay. Tanpa ketidakpastian.' },
  { icon: BadgePercent, title: 'Biaya Operasional Rendah', desc: 'Fee transparan di quote, tanpa alur manual dan biaya multi-lapis.' },
  { icon: Globe, title: 'Jangkauan Bank Lokal', desc: 'Cair ke bank-bank besar Indonesia, settle dalam IDR secara otomatis.' },
  { icon: Clock, title: 'Always-On', desc: 'Loket digital 24/7 dengan performa prediktabel, bahkan saat volume tinggi.' },
  { icon: Layers, title: 'Dibangun untuk Skala', desc: 'Rails modern untuk arus retail hingga enterprise, bukan batasan legacy.' },
  { icon: Shield, title: 'Lapisan Kontrol Terpadu', desc: 'Likuiditas, routing, verifikasi, dan settlement, semua di satu tempat.' },
];

const N = WHY.length;

/** Interpolasi linear piecewise dengan clamp di ujung. */
function pw(x: number, knots: Array<[number, number]>): number {
  if (x <= knots[0][0]) return knots[0][1];
  for (let k = 1; k < knots.length; k++) {
    if (x <= knots[k][0]) {
      const [x0, y0] = knots[k - 1];
      const [x1, y1] = knots[k];
      const t = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
      return y0 + (y1 - y0) * t;
    }
  }
  return knots[knots.length - 1][1];
}

const smoothstep = (u: number) => u * u * (3 - 2 * u);

/** Plateau: di luar jendela transisi, kunci ke card dominan terdekat. */
function plateau(p: number): number {
  const base = Math.floor(p);
  const f = p - base;
  if (f <= PLATEAU) return base;
  if (f >= 1 - PLATEAU) return base + 1;
  return base + smoothstep((f - PLATEAU) / (1 - 2 * PLATEAU));
}

/** Dead-zone kontinu: dalam +-SNAP dari integer, kunci persis (tanpa lompatan). */
function settle(v: number): number {
  const r = Math.round(v);
  const e = v - r;
  const a = Math.abs(e);
  if (a < SNAP) return r;
  return r + (Math.sign(e) || 0) * ((a - SNAP) / (0.5 - SNAP)) * 0.5;
}

function CardItem({
  index,
  card,
  p,
  tuneRef,
  active,
  hidden,
}: {
  index: number;
  card: (typeof WHY)[number];
  p: MotionValue<number>;
  tuneRef: { current: Tune };
  active: boolean;
  hidden: boolean;
}) {
  const y = useTransform(p, (v) => {
    const t = tuneRef.current;
    const d = index - v;
    return d * (d < 0 ? t.gapBehind : t.gapAhead);
  });
  const scale = useTransform(p, (v) => 1 - 0.03 * Math.min(Math.abs(index - v), 2));
  const opacity = useTransform(p, (v) => {
    const t = tuneRef.current;
    const d = index - v;
    const a = Math.abs(d);
    return pw(a, d < 0 ? t.opBehind : t.opAhead);
  });
  const blurPx = useTransform(p, (v) => {
    const t = tuneRef.current;
    const d = index - v;
    const a = Math.abs(d);
    return pw(a, d < 0 ? t.blurBehind : t.blurAhead) * t.blurFactor;
  });
  const filter = useTransform(blurPx, (b) => (b < 0.05 ? 'none' : `blur(${b}px)`));
  const zIndex = useTransform(p, (v) => {
    const d = index - v;
    return 30 - Math.round(Math.min(Math.abs(d), 4)) * 4 - (d > 0 ? 1 : 0);
  });

  const Icon = card.icon;

  return (
    <motion.div
      aria-hidden={hidden || undefined}
      className="absolute inset-x-0 top-0"
      style={{ y, scale, opacity, filter, zIndex, willChange: 'transform, opacity' }}
    >
      <div
        className={clsx(
          'rounded-2xl border bg-[#141416] transition-[border-color,box-shadow] duration-300',
          active
            ? 'border-[var(--k-accent)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_18px_50px_rgba(0,0,0,0.5),0_0_36px_rgba(150,121,79,0.22)]'
            : 'border-[#232326] shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_18px_50px_rgba(0,0,0,0.5)]',
        )}
      >
        <div className="flex min-h-[104px] items-center gap-4 px-6 py-5 lg:min-h-[112px]">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-[rgba(150,121,79,0.30)] bg-[rgba(150,121,79,0.12)]">
            <Icon className="h-5 w-5 text-[var(--k-accent)]" aria-hidden />
          </div>
          <div className="min-w-0">
            <h3 className="mb-0.5 text-[18px] font-semibold leading-snug text-[#F5F5F5]">{card.title}</h3>
            <p className="text-sm leading-relaxed text-[#8B8B93]">{card.desc}</p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export function WhyCards() {
  const trackRef = useRef<HTMLDivElement>(null);
  const pinRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [reduce, setReduce] = useState<boolean>(() => {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  });
  const [active, setActive] = useState(0);
  const [pinned, setPinned] = useState(false);
  const tuneRef = useRef<Tune>(TUNE_DESKTOP);
  tuneRef.current = isMobile ? TUNE_MOBILE : TUNE_DESKTOP;

  const { scrollY } = useScroll();
  const rawP = useMotionValue(0); // 0..N-1
  const update = useCallback(() => {
    const track = trackRef.current;
    const pin = pinRef.current;
    if (!track || !pin) return;
    // Center-pin: sisa viewport dibagi dua (fallback 88px bila pin lebih
    // tinggi dari layar). Tulis hanya saat berubah agar tak reflow tiap tick.
    const centered = Math.max(88, Math.round((window.innerHeight - pin.offsetHeight) / 2));
    const topStr = `${centered}px`;
    if (pin.style.top !== topStr) pin.style.top = topStr;
    const pinTop = parseFloat(getComputedStyle(pin).top) || 0;
    const dist = track.offsetHeight - pin.offsetHeight; // = (N-1)*step
    const raw = dist > 0 ? (pinTop - track.getBoundingClientRect().top) / dist : 0;
    rawP.set(Math.min(1, Math.max(0, raw)) * (N - 1));
    setPinned((prev) => {
      const next = raw > 0.001 && raw < 0.999;
      return prev === next ? prev : next;
    });
  }, [rawP]);

  const vpRaw = useTransform(rawP, plateau);
  const p = useSpring(vpRaw, { stiffness: 260, damping: 32, mass: 0.6, restDelta: 0.0005, restSpeed: 0.0005 });
  // Dead-zone: semua turunan (CardItem, bar, counter) pakai ps, bukan p.
  const ps = useTransform(p, settle);
  const barScale = useTransform(ps, [0, N - 1], [0, 1]);

  useMotionValueEvent(ps, 'change', (v) => {
    const a = Math.max(0, Math.min(N - 1, Math.round(v)));
    setActive((prev) => (prev === a ? prev : a));
  });
  useMotionValueEvent(scrollY, 'change', update);

  useEffect(() => {
    update();
    const ro = new ResizeObserver(update);
    if (trackRef.current) ro.observe(trackRef.current);
    if (pinRef.current) ro.observe(pinRef.current);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [update, isMobile]);

  useEffect(() => {
    const mqM = window.matchMedia('(max-width: 1023.5px)');
    const mqR = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => {
      setIsMobile(mqM.matches);
      setReduce(mqR.matches);
    };
    apply();
    mqM.addEventListener('change', apply);
    mqR.addEventListener('change', apply);
    return () => {
      mqM.removeEventListener('change', apply);
      mqR.removeEventListener('change', apply);
    };
  }, []);

  const scrollToCard = (idx: number) => {
    const track = trackRef.current;
    const pin = pinRef.current;
    if (!track || !pin) return;
    const pinTop = parseFloat(getComputedStyle(pin).top) || 0;
    const dist = track.offsetHeight - pin.offsetHeight;
    const trackDocTop = track.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: trackDocTop - pinTop + (idx / (N - 1)) * dist, behavior: 'smooth' });
  };

  if (reduce) {
    return (
        <section className="py-12 sm:py-16" style={{ '--k-accent': '#96794F' } as CSSProperties}>
          <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.05em] text-[#D4B78F]">Kenapa KORAMP</p>
            <h2 className="mb-3 text-3xl font-semibold tracking-[-0.02em] text-[#F5F5F5] sm:text-4xl">
              Kenapa pengguna memilih KORAMP
            </h2>
            <p className="mb-10 max-w-2xl text-sm leading-relaxed text-[#8B8B93]">
              Infrastruktur untuk skala global, kecepatan, dan kepastian.
            </p>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {WHY.map((f) => (
                <div key={f.title} className="h-full rounded-2xl border border-[#232326] bg-[#141416] p-6">
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-[rgba(150,121,79,0.30)] bg-[rgba(150,121,79,0.12)]">
                    <f.icon className="h-5 w-5 text-[var(--k-accent)]" aria-hidden />
                  </div>
                  <h3 className="mb-2 text-[18px] font-semibold text-[#F5F5F5]">{f.title}</h3>
                  <p className="text-sm leading-relaxed text-[#8B8B93]">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
    );
  }

  return (
    <section
      style={{ '--k-accent': '#96794F' } as CSSProperties}
      className="relative overflow-x-clip [overflow-anchor:none] px-0 pb-0 pt-12 sm:pt-16 [--step:160px] lg:[--step:200px]"
    >
      <div ref={trackRef} data-scrub-track className="mx-auto max-w-[1200px] px-4 sm:px-6">
        <div ref={pinRef} className="sticky" style={{ top: '88px' }}>
          <div className="grid items-start gap-8 lg:grid-cols-[5fr_6fr] lg:gap-12">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.05em] text-[#D4B78F]">Kenapa KORAMP</p>
              <h2 className="mb-2 text-3xl font-semibold tracking-[-0.02em] text-[#F5F5F5] sm:text-4xl">
                Kenapa pengguna memilih KORAMP
              </h2>
              <p className="text-sm leading-relaxed text-[#8B8B93]">
                Infrastruktur untuk skala global, kecepatan, dan kepastian.
              </p>

              <p className="mt-6 font-mono text-2xl tabular-nums text-[#F5F5F5]">
                {String(active + 1).padStart(2, '0')}
                <span className="text-[#8B8B93]"> / {String(N).padStart(2, '0')}</span>
              </p>
              <div className="mt-2 h-px w-full max-w-[220px] bg-[#232326]">
                <motion.div className="h-px origin-left bg-[var(--k-accent)]" style={{ scaleX: barScale }} />
              </div>
              <div
                className={clsx(
                  'mt-4 flex gap-2 transition-opacity duration-300',
                  pinned ? 'opacity-100' : 'pointer-events-none opacity-0',
                )}
                role="group"
                aria-label="Navigasi card"
              >
                {WHY.map((c, i) => (
                  <button
                    key={c.title}
                    type="button"
                    onClick={() => scrollToCard(i)}
                    title={c.title}
                    aria-label={`Ke card ${i + 1}: ${c.title}`}
                    aria-current={active === i || undefined}
                    className={clsx(
                      'h-1.5 rounded-full transition-all duration-300',
                      active === i ? 'w-8 bg-[var(--k-accent)]' : 'w-1.5 bg-[#3A3A3F] hover:bg-[#8B8B93]',
                    )}
                  />
                ))}
              </div>
            </div>

            <div className="relative h-[190px] lg:h-[200px]">
              {WHY.map((card, i) => (
                <CardItem
                  key={card.title}
                  index={i}
                  card={card}
                  p={ps}
                  tuneRef={tuneRef}
                  active={active === i}
                  hidden={Math.abs(i - active) > 2}
                />
              ))}
            </div>
          </div>
        </div>
        <div aria-hidden style={{ height: 'calc(5 * var(--step))' }} />
      </div>
    </section>
  );
}
