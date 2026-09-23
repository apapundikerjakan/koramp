'use client';

/**
 * KORAMP motion primitives — prompt UI §4 & §6.
 *
 * Adapted patterns: Beam border (Beam), tilt (beUI), thinking orbs +
 * streaming text (AICSS/Beautiful UI), tool chips + task rows (Beautiful UI),
 * animated counter + pulse ring (Animata), particle burst (KokonutUI),
 * stagger reveal (Animata), approval card.
 *
 * Every primitive honors `prefers-reduced-motion` and stays functional
 * without animation. Decorative layers are `aria-hidden`.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type MouseEvent,
} from 'react';
import {
  motion,
  AnimatePresence,
  useReducedMotion,
  useMotionValue,
  useSpring,
  useTransform,
} from 'framer-motion';
import clsx from 'clsx';
import { Check, CheckCircle2, Copy, Loader2, XCircle, Circle } from 'lucide-react';

// ─── Scroll reveal ────────────────────────────────────────────────────────────

export function Reveal({
  children,
  delay = 0,
  y = 24,
  className,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.5, delay, ease: [0.0, 0, 0.2, 1] }}
    >
      {children}
    </motion.div>
  );
}

export function Stagger({
  children,
  className,
  delay = 0,
  gap = 0.08,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  gap?: number;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: '-60px' }}
      variants={{ hidden: {}, show: { transition: { staggerChildren: gap, delayChildren: delay } } }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 0, y: 24 },
        show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.0, 0, 0.2, 1] } },
      }}
    >
      {children}
    </motion.div>
  );
}

// ─── Beam border (Beam libraries.dev) ─────────────────────────────────────────

const BEAM_COLORS: Record<string, string> = {
  brand: '#C7A048, #D9B75F, #1F5C43, #C7A048',
  sol: '#a855f7, #C7A048, #e879f9, #a855f7',
  eth: '#3b82f6, #C7A048, #4A90A4, #3b82f6',
  bnb: '#eab308, #f59e0b, #fde047, #eab308',
  green: '#4CAF6D, #2A7A58, #a3e635, #4CAF6D',
};

/** Animated conic-gradient border. Inactive → plain subtle border. */
export function BeamBorder({
  children,
  active = true,
  color = 'brand',
  radius = 'rounded-2xl',
  className,
  contentClassName,
}: {
  children: ReactNode;
  active?: boolean;
  color?: keyof typeof BEAM_COLORS | string;
  radius?: string;
  className?: string;
  contentClassName?: string;
}) {
  const reduce = useReducedMotion();
  const gradient = BEAM_COLORS[color] ?? BEAM_COLORS.brand;
  if (!active || reduce) {
    return <div className={clsx(radius, 'border border-line-subtle', className)}>{children}</div>;
  }
  return (
    <div className={clsx('relative p-[1.5px]', radius, className)} aria-hidden={false}>
      <div className={clsx('absolute inset-0 overflow-hidden', radius)} aria-hidden>
        <div
          className="absolute animate-beam-spin"
          style={{
            inset: '-60%',
            background: `conic-gradient(from 0deg, ${gradient})`,
          }}
        />
      </div>
      <div className={clsx('relative bg-surface-1', radius, contentClassName)}>{children}</div>
    </div>
  );
}

// ─── Tilt card (beUI) ─────────────────────────────────────────────────────────

export function TiltCard({
  children,
  className,
  max = 5,
  disabled = false,
}: {
  children: ReactNode;
  className?: string;
  max?: number;
  disabled?: boolean;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const mx = useMotionValue(0.5);
  const my = useMotionValue(0.5);
  const rotateX = useSpring(useTransform(my, [0, 1], [max, -max]), { stiffness: 200, damping: 18 });
  const rotateY = useSpring(useTransform(mx, [0, 1], [-max, max]), { stiffness: 200, damping: 18 });
  const [coarse, setCoarse] = useState(false);

  useEffect(() => {
    try {
      setCoarse(window.matchMedia('(pointer: coarse)').matches);
    } catch { /* SSR — tilt stays enabled, harmless */ }
  }, []);

  const onMove = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const el = ref.current;
      if (!el || disabled || reduce || coarse) return;
      const r = el.getBoundingClientRect();
      mx.set((e.clientX - r.left) / r.width);
      my.set((e.clientY - r.top) / r.height);
    },
    [disabled, reduce, coarse, mx, my],
  );
  const onLeave = useCallback(() => {
    mx.set(0.5);
    my.set(0.5);
  }, [mx, my]);

  if (disabled || reduce || coarse) return <div className={className}>{children}</div>;
  return (
    <motion.div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      style={{ rotateX, rotateY, transformPerspective: 800 }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ─── Thinking orbs (AICSS) ────────────────────────────────────────────────────

export function ThinkingOrbs({ label, className }: { label?: string; className?: string }) {
  return (
    <span
      className={clsx('inline-flex items-center gap-1.5', className)}
      role="status"
      aria-label={label ?? 'Memproses'}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          aria-hidden
          className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-orb"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
      {label && <span className="text-xs text-gray-400 ml-1">{label}</span>}
    </span>
  );
}

// ─── Streaming text (AICSS / Beautiful UI) ────────────────────────────────────

export function StreamingText({
  text,
  speed = 18,
  className,
}: {
  text: string;
  speed?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const [n, setN] = useState(reduce ? text.length : 0);
  useEffect(() => {
    if (reduce) {
      setN(text.length);
      return;
    }
    setN(0);
    if (!text) return;
    const id = setInterval(() => {
      setN((v) => {
        if (v >= text.length) {
          clearInterval(id);
          return v;
        }
        return v + 1;
      });
    }, speed);
    return () => clearInterval(id);
  }, [text, speed, reduce]);
  return (
    <span className={clsx(n < text.length && 'stream-cursor', className)} aria-live="polite">
      {text.slice(0, n)}
    </span>
  );
}

// ─── Tool chip (Beautiful UI) ─────────────────────────────────────────────────

export function ToolChip({
  state,
  children,
  className,
}: {
  state: 'running' | 'done' | 'failed' | 'pending';
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border',
        state === 'running' && 'bg-blue-500/10 text-blue-300 border-blue-500/20',
        state === 'done' && 'bg-green-500/10 text-green-300 border-green-500/20',
        state === 'failed' && 'bg-red-500/10 text-red-300 border-red-500/20',
        state === 'pending' && 'bg-white/5 text-gray-400 border-line-subtle',
        className,
      )}
      role="status"
    >
      {state === 'running' && <Loader2 className="w-3 h-3 animate-spin" aria-hidden />}
      {state === 'done' && <Check className="w-3 h-3" aria-hidden />}
      {state === 'failed' && <XCircle className="w-3 h-3" aria-hidden />}
      {state === 'pending' && <Circle className="w-3 h-3" aria-hidden />}
      {children}
    </span>
  );
}

// ─── Task row (Beautiful UI) ──────────────────────────────────────────────────

export type TaskState = 'pending' | 'running' | 'done' | 'failed';

export function TaskRow({
  label,
  detail,
  state,
}: {
  label: string;
  detail?: string;
  state: TaskState;
}) {
  return (
    <div
      className={clsx(
        'flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors',
        state === 'running' ? 'bg-brand-600/5 border-brand-600/20' : 'bg-transparent border-transparent',
      )}
    >
      <span className="flex-shrink-0" aria-hidden>
        {state === 'done' ? (
          <motion.span
            initial={{ scale: 0.6 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 400, damping: 15 }}
            className="block"
          >
            <CheckCircle2 className="w-5 h-5 text-green-400" />
          </motion.span>
        ) : state === 'running' ? (
          <Loader2 className="w-5 h-5 text-brand-400 animate-spin" />
        ) : state === 'failed' ? (
          <XCircle className="w-5 h-5 text-red-400" />
        ) : (
          <Circle className="w-5 h-5 text-ink-muted" />
        )}
      </span>
      <div className="min-w-0">
        <p className={clsx('text-sm', state === 'done' ? 'text-green-400' : state === 'running' ? 'text-white font-semibold' : state === 'failed' ? 'text-red-400' : 'text-ink-muted')}>
          {label}
        </p>
        {detail && <p className="text-xs text-gray-500 truncate">{detail}</p>}
      </div>
    </div>
  );
}

// ─── Animated counter (Animata) ───────────────────────────────────────────────

export function AnimatedCounter({
  value,
  format,
  className,
  duration,
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
  duration?: number;
}) {
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(reduce ? value : 0);
  const shown = useMemo(
    () => (format ? format(display) : display.toLocaleString('id-ID')),
    [display, format],
  );
  useEffect(() => {
    if (reduce) {
      setDisplay(value);
      return;
    }
    const ms = duration ?? (Math.abs(value) > 1_000_000 ? 800 : 400);
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(value * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration, reduce]);
  return <span className={className}>{shown}</span>;
}

// ─── Pulse rings (Animata) ────────────────────────────────────────────────────

export function PulseRings({ color = 'bg-brand-500/40', className }: { color?: string; className?: string }) {
  const reduce = useReducedMotion();
  if (reduce) return null;
  return (
    <span aria-hidden className={clsx('absolute inset-0 pointer-events-none', className)}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={clsx('absolute inset-0 rounded-[inherit] animate-pulse-ring', color)}
          style={{ animationDelay: `${i * 0.65}s` }}
        />
      ))}
    </span>
  );
}

// ─── Shimmer text (KokonutUI) ─────────────────────────────────────────────────

export function ShimmerText({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={clsx('shimmer-text', className)}>{children}</span>;
}

// ─── QR frame ─────────────────────────────────────────────────────────────────

export function QrFrame({
  waiting,
  confirmed,
  children,
  caption,
}: {
  waiting: boolean;
  confirmed: boolean;
  children: ReactNode;
  caption?: string;
}) {
  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        {waiting && !confirmed && <PulseRings className="rounded-2xl" />}
        <BeamBorder active={waiting && !confirmed} radius="rounded-2xl">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 20 }}
            className="p-4 bg-white rounded-2xl inline-block shadow-xl shadow-black/20"
          >
            <AnimatePresence mode="wait">
              {confirmed ? (
                <motion.div
                  key="done"
                  initial={{ scale: 0 }}
                  animate={{ scale: [0, 1.2, 1] }}
                  transition={{ duration: 0.4 }}
                  className="w-[240px] h-[240px] flex items-center justify-center"
                  role="status"
                  aria-label="Pembayaran dikonfirmasi"
                >
                  <CheckCircle2 className="w-24 h-24 text-green-500" />
                </motion.div>
              ) : (
                <motion.div key="qr" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }}>
                  {children}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </BeamBorder>
      </div>
      {caption && <p className="text-gray-600 text-xs mt-3">{caption}</p>}
    </div>
  );
}

// ─── Approval card ────────────────────────────────────────────────────────────

export function ApprovalCard({
  title,
  rows,
  onConfirm,
  onCancel,
  confirmLabel = 'Konfirmasi',
  confirming = false,
}: {
  title: string;
  rows: { label: string; value: ReactNode }[];
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  confirming?: boolean;
}) {
  return (
    <motion.div
      initial={{ y: 40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 40, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 28 }}
      className="card-elevated glass p-5 space-y-3"
      role="dialog"
      aria-label={title}
    >
      <p className="text-white font-bold">{title}</p>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.label} className="flex justify-between text-sm">
            <span className="text-gray-500">{r.label}</span>
            <span className="text-white font-semibold text-right">{r.value}</span>
          </div>
        ))}
      </div>
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onCancel} className="btn-secondary flex-1 text-sm py-2.5">
          Batal
        </button>
        <button type="button" onClick={onConfirm} disabled={confirming} className="btn-primary flex-1 text-sm py-2.5">
          {confirming ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : confirmLabel}
        </button>
      </div>
    </motion.div>
  );
}

// ─── Copy button (Copy → Check) ───────────────────────────────────────────────

export function CopyButton({ text, label = 'Salin' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.9 }}
      onClick={() => {
        try {
          navigator.clipboard.writeText(text);
        } catch { /* clipboard unavailable — still show feedback */ }
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 2000);
      }}
      className="icon-btn"
      aria-label={copied ? 'Disalin' : label}
      title={copied ? 'Disalin!' : label}
    >
      {copied ? <CheckCircle2 className="w-4 h-4 text-green-400" aria-hidden /> : <Copy className="w-4 h-4" aria-hidden />}
    </motion.button>
  );
}

// ─── Particle burst (KokonutUI success) ───────────────────────────────────────

export function ParticleBurst({ count = 50, colors = ['#C7A048', '#1F5C43', '#F5F1E8', '#D9A441'] }: { count?: number; colors?: string[] }) {
  const reduce = useReducedMotion();
  const parts = useMemo(() => {
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    return Array.from({ length: count }, (_, i) => ({
      id: i,
      x: (rand() - 0.5) * 320,
      y: (rand() - 0.5) * 320,
      size: 3 + rand() * 4,
      color: colors[i % colors.length],
      delay: rand() * 0.1,
    }));
  }, [count, colors]);
  if (reduce) return null;
  return (
    <span aria-hidden className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-visible">
      {parts.map((p) => (
        <motion.span
          key={p.id}
          initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
          animate={{ x: p.x, y: p.y, opacity: 0, scale: 0.4 }}
          transition={{ duration: 0.8, delay: p.delay, ease: 'easeOut' }}
          className="absolute rounded-full"
          style={{ width: p.size, height: p.size, background: p.color }}
        />
      ))}
    </span>
  );
}
