'use client';

import type { ReactNode } from 'react';
import { motion } from 'framer-motion';

/** Fade sekali (opacity saja, tanpa offset y) — untuk area pin/video. */
function Fade({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}

interface SplitSectionProps {
  id?: string;
  eyebrow: string;
  title: ReactNode;
  desc?: string;
  visual: ReactNode;
  children: ReactNode;
  /** true = visual kiri di >=lg (scene 2). false = visual kanan (scene 1 & 3). */
  reverse?: boolean;
  /**
   * true = pinned scrollytelling (desktop): section jadi track tinggi,
   * konten sticky 1 viewport — scroll tertahan sampai scrub video selesai.
   * Nonaktif di mobile & prefers-reduced-motion (flow normal).
   */
  pin?: boolean;
}

/** Side-by-side: header penuh di atas, lalu grid visual + teks. Mobile: header -> visual -> konten. */
export function SplitSection({ id, eyebrow, title, desc, visual, children, reverse, pin }: SplitSectionProps) {
  const header = (
    <Fade className="mb-8 max-w-2xl">
      <p className="text-[#D4B78F] text-xs font-semibold uppercase tracking-[0.05em] mb-3">{eyebrow}</p>
      <h2 className="font-semibold text-3xl sm:text-4xl text-[#F5F5F5] tracking-[-0.02em] mb-3">{title}</h2>
      {desc ? <p className="text-[#8B8B93] text-sm leading-relaxed">{desc}</p> : null}
    </Fade>
  );
  const grid = (
    <div className="grid gap-8 lg:gap-12 lg:grid-cols-[5fr_6fr] items-center">
      <Fade className={reverse ? 'lg:order-1' : 'lg:order-2'}>
        <div>{visual}</div>
      </Fade>
      <div className={reverse ? 'lg:order-2' : 'lg:order-1'}>{children}</div>
    </div>
  );

  if (!pin) {
    return (
      <section id={id} className="py-12 sm:py-16">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
          {header}
          {grid}
        </div>
      </section>
    );
  }

  return (
    <section
      id={id}
      data-scrub-track
      className="relative py-12 sm:py-16 lg:py-0 lg:h-[180vh] motion-reduce:lg:h-auto"
    >
      <div className="lg:sticky lg:top-0 lg:h-screen lg:flex lg:items-center lg:overflow-hidden motion-reduce:lg:static motion-reduce:lg:h-auto motion-reduce:lg:block">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 w-full py-10 lg:py-0">
          {header}
          {grid}
        </div>
      </div>
    </section>
  );
}
