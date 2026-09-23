'use client';

/**
 * useWalletSelection — reactive per-ecosystem wallet selection.
 *
 * Single source of truth remains walletStore (localStorage associations +
 * preferred keys). This hook only subscribes: it reloads when any mutation
 * emits, when another tab edits storage, or when a provider disconnect
 * transition clears a stale selection. No second state system.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  loadAssociations, resolveSelection, clearPreferred,
  type AssociatedWallet, type AssociatedEcosystem, type EcosystemSelection,
} from './walletStore';

const CHANGED_EVENT = 'kipramp:wallets-changed';

/** Membership equality: address + ecosystem + label. Ignores lastUsedAt churn. */
function sameMembership(a: AssociatedWallet[], b: AssociatedWallet[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((w, i) => {
    const o = b[i];
    return (
      !!o &&
      o.address.toLowerCase() === w.address.toLowerCase() &&
      o.ecosystem === w.ecosystem &&
      (o.label ?? null) === (w.label ?? null)
    );
  });
}

export interface WalletSelection {
  associations: AssociatedWallet[];
  evm: EcosystemSelection;
  sol: EcosystemSelection;
  refresh: () => void;
}

export function useWalletSelection(
  liveEvm: string | null,
  liveSol: string | null,
): WalletSelection {
  const [associations, setAssociations] = useState<AssociatedWallet[]>(() => loadAssociations());
  const [tick, setTick] = useState(0);
  const prevLive = useRef<{ evm: string | null; sol: string | null }>({ evm: liveEvm, sol: liveSol });

  // Identity-stable refresh: walletStore rewrites lastUsedAt/label on every
  // rememberWallet() call, producing a new array with identical membership.
  // Propagating that identity would re-fire every consumer effect that
  // depends on `associations` (support badge fetch, order polling) and reset
  // their intervals — a fetch storm. Only propagate real membership changes.
  const refresh = useCallback(() => {
    const next = loadAssociations();
    setAssociations((prev) => (sameMembership(prev, next) ? prev : next));
    setTick((t) => t + 1);
  }, []);

  // Scenario I: a provider disconnect transition (live → null) clears that
  // ecosystem's explicit selection. Reconnect + single-remaining auto-select
  // is then handled by resolveSelection below. Explicit choices made while
  // already disconnected are never cleared here.
  useEffect(() => {
    const prev = prevLive.current;
    let changed = false;
    if (prev.evm && !liveEvm) {
      clearPreferred('EVM');
      changed = true;
    }
    if (prev.sol && !liveSol) {
      clearPreferred('SOLANA');
      changed = true;
    }
    prevLive.current = { evm: liveEvm, sol: liveSol };
    if (changed) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveEvm, liveSol]);

  useEffect(() => {
    const onChange = () => refresh();
    window.addEventListener(CHANGED_EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener(CHANGED_EVENT, onChange);
      window.removeEventListener('storage', onChange);
    };
  }, [refresh]);

  const evm = resolveSelection('EVM', associations);
  const sol = resolveSelection('SOLANA', associations);
  void tick;

  return { associations, evm, sol, refresh };
}

export type { AssociatedEcosystem };
