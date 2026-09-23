'use client';

/**
 * KiprampLoader — premium full-screen preloader (reusable).
 *
 * One continuous word transformation, GPU-only animation
 * (transform + opacity, 0.1s transitions, cubic-bezier):
 *   "Tukar" in → cycling currency word (slide vertical) → "jadi" joins and
 *   pairs keep cycling → fade to KORAMP + logo reveal → hold until the
 *   destination page reports ready → smooth fade out.
 *
 * Robustness: NO AnimatePresence mode="wait" anywhere inside — every phase
 * and word uses enter-only animations (initial → animate) so a slow or
 * stuck exit can never freeze the sequence. Restart re-mounts by key.
 *
 * Props:
 * - ready: destination page has rendered (fonts/first paint settled).
 * - onExited: called after the fade-out completes (parent unmounts).
 * Honors prefers-reduced-motion (simple fades, no sliding).
 */

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { motion, useReducedMotion } from 'framer-motion';

const EASE: [number, number, number, number] = [0.4, 0, 0.2, 1];
const T = 0.1; // every transition ≈ 0.1s — no 0.3s timings anywhere here
const DWELL = 520; // per-word readability pause (transition itself stays 0.1s
const HOLD_REPEAT_MS = 4000; // replay from tukar while the page isn't ready

const WORDS = ['crypto', 'rupiah', 'USD', 'PayPal'];
const PAIRS: Array<[string, string]> = [
  ['crypto', 'rupiah'],
  ['rupiah', 'USD'],
  ['USD', 'PayPal'],
];

type Step = 'tukar' | 'words' | 'jadi' | 'reveal' | 'hold' | 'exit';

const DEV = process.env.NODE_ENV !== 'production';

export function KiprampLoader({ ready, onExited }: { ready: boolean; onExited: () => void }) {
  const reduce = useReducedMotion();
  const [step, setStep] = useState<Step>('tukar');
  const [wi, setWi] = useState(0); // WORDS index
  const [pi, setPi] = useState(0); // PAIRS index
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const doneRef = useRef(false);
  const onExitedRef = useRef(onExited);
  onExitedRef.current = onExited;

  // Phase driver — timeout chain, transform/opacity only.
  useEffect(() => {
    if (DEV) {
      // eslint-disable-next-line no-console
      console.debug(`[loader] step=${step} wi=${wi} pi=${pi} ready=${readyRef.current}`);
    }
    if (reduce) {
      const id = setTimeout(() => setStep('reveal'), 250);
      return () => clearTimeout(id);
    }
    let id: ReturnType<typeof setTimeout> | undefined;
    if (step === 'tukar') {
      id = setTimeout(() => setStep('words'), 320);
    } else if (step === 'words') {
      id = setTimeout(() => {
        if (wi + 1 < WORDS.length) setWi(wi + 1);
        else {
          setPi(0);
          setStep('jadi');
        }
      }, DWELL);
    } else if (step === 'jadi') {
      id = setTimeout(() => {
        if (pi + 1 < PAIRS.length) setPi(pi + 1);
        else setStep('reveal');
      }, DWELL);
    } else if (step === 'reveal') {
      id = setTimeout(() => setStep('hold'), 650);
    } else if (step === 'hold') {
      const holdStartedAt = Date.now();
      const loop = setInterval(() => {
        if (readyRef.current && !doneRef.current) {
          doneRef.current = true;
          clearInterval(loop);
          setStep('exit');
          return;
        }
        // Not ready after a while → replay FULL sequence from tukar.
        if (!doneRef.current && Date.now() - holdStartedAt >= HOLD_REPEAT_MS) {
          if (DEV) {
            // eslint-disable-next-line no-console
            console.debug('[loader] restarting sequence from tukar');
          }
          clearInterval(loop);
          setWi(0);
          setPi(0);
          setStep('tukar');
        }
      }, 250);
      return () => clearInterval(loop);
    } else if (step === 'exit') {
      id = setTimeout(() => onExitedRef.current(), 380);
    }
    return () => {
      if (id) clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, wi, pi, reduce]);

  const inSeq = step === 'tukar' || step === 'words' || step === 'jadi';
  const inBrand = step === 'reveal' || step === 'hold';
  const pair = PAIRS[pi];

  return (
    <motion.div
      role="status"
      aria-label="Memuat KORAMP"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#08080A]"
      style={{ width: '100vw', height: '100vh' }}
      initial={{ opacity: 1 }}
      animate={{ opacity: step === 'exit' ? 0 : 1 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
    >
      <div className="px-6 text-center w-full max-w-3xl mx-auto">
        {inSeq && (
          <div
            key={`seq-${wi}-${pi}-${step}`}
            className="font-bold text-[#F5F5F5] tracking-[-0.02em] leading-tight text-[clamp(2rem,7vw,3.75rem)]"
          >
            <motion.span
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: T, ease: EASE }}
              className="inline-block"
            >
              Tukar
            </motion.span>{' '}
            <span className="relative inline-flex align-baseline overflow-hidden min-w-[4ch]">
              <motion.span
                key={step === 'jadi' ? `p1-${pair[0]}` : `w-${WORDS[wi]}`}
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: -16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: T, ease: EASE }}
                className="inline-block text-[#D4B78F]"
              >
                {step === 'jadi' ? pair[0] : WORDS[wi]}
              </motion.span>
            </span>
            {step === 'jadi' && (
              <>
                {' '}
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: T, ease: EASE }}
                  className="inline-block"
                >
                  jadi
                </motion.span>{' '}
                <span className="relative inline-flex align-baseline overflow-hidden min-w-[4ch]">
                  <motion.span
                    key={`p2-${pair[1]}`}
                    initial={reduce ? { opacity: 0 } : { opacity: 0, y: -16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: T, ease: EASE }}
                    className="inline-block text-[#D4B78F]"
                  >
                    {pair[1]}
                  </motion.span>
                </span>
              </>
            )}
          </div>
        )}

        {inBrand && (
          <motion.div
            key="brand"
            initial={{ opacity: 0 }}
            animate={
              step === 'hold' && !reduce
                ? { opacity: [1, 0.72, 1] } // loop halus selama menunggu halaman siap
                : { opacity: 1 }
            }
            transition={
              step === 'hold' && !reduce
                ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' }
                : { duration: reduce ? 0.25 : 0.3, ease: EASE }
            }
            className="flex items-center justify-center gap-0"
          >
            <motion.span
              initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: T, ease: EASE }}
              className="inline-flex flex-shrink-0"
            >
              <Image src="/logo.png" alt="" aria-hidden width={168} height={168} priority className="w-[132px] h-[132px] sm:w-[168px] sm:h-[168px]" />
            </motion.span>
            <motion.span
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: T, ease: EASE }}
              className="font-bold text-[#F5F5F5] tracking-[-0.02em] leading-none text-[clamp(2.25rem,8vw,4.25rem)] -ml-4 sm:-ml-5"
            >
              ORAMP
            </motion.span>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
