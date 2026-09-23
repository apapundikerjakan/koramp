'use client';

import { useEffect } from 'react';

/**
 * Mutes errors that originate from browser extensions (chrome-extension://,
 * moz-extension://) and the "Cannot redefine property: ethereum" conflict
 * that happens when multiple wallet extensions try to inject window.ethereum.
 *
 * These errors are NOT from our code and cannot be fixed here — they are a
 * known issue with wallet extensions (MetaMask, Phantom, etc.) competing over
 * window.ethereum on the same page.
 *
 * Mount this once at the root layout so it runs before any extension injects.
 */
export function ClientErrorFilter() {
  useEffect(() => {
    // Patterns that are always extension-origin noise, never our code
    const NOISE: RegExp[] = [
      /chrome-extension:\/\//i,
      /moz-extension:\/\//i,
      /Cannot redefine property:\s*ethereum/i,
      /Cannot redefine property:\s*solana/i,
      /Unchecked runtime\.lastError/i,
    ];

    function isNoise(msg: string | Event): boolean {
      const text = typeof msg === 'string' ? msg : (msg as ErrorEvent).message ?? '';
      return NOISE.some((re) => re.test(text));
    }

    // Suppress synchronous errors from extensions
    const origOnError = window.onerror;
    window.onerror = function (message, source, lineno, colno, error) {
      // If source is a chrome/moz extension URL, swallow silently
      if (typeof source === 'string' && /chrome-extension:|moz-extension:/i.test(source)) {
        return true; // returning true prevents the default handler
      }
      if (typeof message === 'string' && isNoise(message)) {
        return true;
      }
      // Pass through to original handler (React error overlay in dev, etc.)
      if (typeof origOnError === 'function') {
        return origOnError.call(window, message, source, lineno, colno, error);
      }
      return false;
    };

    // Suppress unhandled promise rejections from extensions
    function onUnhandled(e: PromiseRejectionEvent) {
      const msg = e.reason?.message ?? String(e.reason ?? '');
      if (isNoise(msg)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }

    // Suppress error events bubbling from extension scripts
    function onError(e: ErrorEvent) {
      if (isNoise(e)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }

    window.addEventListener('unhandledrejection', onUnhandled, true);
    window.addEventListener('error', onError, true);

    return () => {
      window.onerror = origOnError;
      window.removeEventListener('unhandledrejection', onUnhandled, true);
      window.removeEventListener('error', onError, true);
    };
  }, []);

  return null;
}
