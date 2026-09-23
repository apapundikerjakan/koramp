'use client';

/**
 * walletStore — client-side wallet association manager.
 *
 * TECHNICAL HONESTY NOTE:
 * The underlying providers (wagmi/RainbowKit for EVM, wallet-adapter for
 * Solana) each expose exactly ONE active provider session at a time. This
 * store therefore keeps a remembered ASSOCIATION LIST per ecosystem
 * (persisted in localStorage) plus one preferred ("active") address per
 * ecosystem. It never pretends multiple on-chain sessions are live at once:
 * the live connected address always comes from WalletContext (the provider).
 * If the preferred address differs from the connected one, the UI tells the
 * user to switch accounts inside their wallet app instead of silently
 * switching anything.
 *
 * Only public addresses + metadata are stored. Never keys/seeds/passwords.
 */

export type AssociatedEcosystem = 'EVM' | 'SOLANA';

export interface AssociatedWallet {
  address: string;
  ecosystem: AssociatedEcosystem;
  label?: string;
  addedAt: number;
  lastUsedAt: number;
}

const LIST_KEY = 'kipramp:wallets:v1';
const ACTIVE_EVM_KEY = 'kipramp:active:EVM';
const ACTIVE_SOL_KEY = 'kipramp:active:SOLANA';
// Explicit user choices (Use Wallet clicks). Auto-selection never writes here,
// so "two or more wallets → require explicit selection" holds even when a
// previous single-wallet auto-select was persisted under ACTIVE_*.
const EXPLICIT_EVM_KEY = 'kipramp:explicit:EVM';
const EXPLICIT_SOL_KEY = 'kipramp:explicit:SOLANA';

function safeParse(raw: string | null): AssociatedWallet[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as AssociatedWallet[];
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (w) =>
        w &&
        typeof w.address === 'string' &&
        (w.ecosystem === 'EVM' || w.ecosystem === 'SOLANA'),
    );
  } catch {
    return [];
  }
}

export function loadAssociations(): AssociatedWallet[] {
  if (typeof window === 'undefined') return [];
  return safeParse(window.localStorage.getItem(LIST_KEY));
}

function persist(list: AssociatedWallet[]): void {
  try {
    window.localStorage.setItem(LIST_KEY, JSON.stringify(list.slice(0, 20)));
  } catch {
    /* storage full/blocked — associations simply won't persist */
  }
}

/** Remember a wallet without removing any existing ones. */
export function rememberWallet(address: string, ecosystem: AssociatedEcosystem, label?: string): AssociatedWallet[] {
  if (typeof window === 'undefined') return [];
  const now = Date.now();
  const list = loadAssociations();
  const idx = list.findIndex(
    (w) => w.address.toLowerCase() === address.toLowerCase() && w.ecosystem === ecosystem,
  );
  if (idx >= 0) {
    list[idx] = { ...list[idx], lastUsedAt: now, label: label ?? list[idx].label };
  } else {
    list.unshift({ address, ecosystem, label, addedAt: now, lastUsedAt: now });
  }
  persist(list);
  emitChanged();
  return list;
}

export function touchWallet(address: string, ecosystem: AssociatedEcosystem): void {
  if (typeof window === 'undefined') return;
  const list = loadAssociations();
  const idx = list.findIndex(
    (w) => w.address.toLowerCase() === address.toLowerCase() && w.ecosystem === ecosystem,
  );
  if (idx >= 0) {
    list[idx] = { ...list[idx], lastUsedAt: Date.now() };
    persist(list);
  }
}

export function forgetWallet(address: string, ecosystem: AssociatedEcosystem): AssociatedWallet[] {
  if (typeof window === 'undefined') return [];
  const list = loadAssociations().filter(
    (w) => !(w.address.toLowerCase() === address.toLowerCase() && w.ecosystem === ecosystem),
  );
  persist(list);
  try {
    const activeKey = ecosystem === 'EVM' ? ACTIVE_EVM_KEY : ACTIVE_SOL_KEY;
    const explicitKey = ecosystem === 'EVM' ? EXPLICIT_EVM_KEY : EXPLICIT_SOL_KEY;
    const active = window.localStorage.getItem(activeKey);
    if (active && active.toLowerCase() === address.toLowerCase()) {
      window.localStorage.removeItem(activeKey);
    }
    const explicit = window.localStorage.getItem(explicitKey);
    if (explicit && explicit.toLowerCase() === address.toLowerCase()) {
      window.localStorage.removeItem(explicitKey);
    }
  } catch {
    /* ignore */
  }
  emitChanged();
  return list;
}

export function getPreferredAddress(ecosystem: AssociatedEcosystem): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(ecosystem === 'EVM' ? ACTIVE_EVM_KEY : ACTIVE_SOL_KEY);
  } catch {
    return null;
  }
}

export function setPreferredAddress(address: string, ecosystem: AssociatedEcosystem, explicit = false): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ecosystem === 'EVM' ? ACTIVE_EVM_KEY : ACTIVE_SOL_KEY, address);
    if (explicit) {
      window.localStorage.setItem(ecosystem === 'EVM' ? EXPLICIT_EVM_KEY : EXPLICIT_SOL_KEY, address);
    }
  } catch {
    /* ignore */
  }
  touchWallet(address, ecosystem);
  emitChanged();
}

export function shortAddress(addr: string): string {
  return addr.length <= 12 ? addr : `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function clearPreferred(ecosystem: AssociatedEcosystem): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(ecosystem === 'EVM' ? ACTIVE_EVM_KEY : ACTIVE_SOL_KEY);
    window.localStorage.removeItem(ecosystem === 'EVM' ? EXPLICIT_EVM_KEY : EXPLICIT_SOL_KEY);
  } catch {
    /* ignore */
  }
  emitChanged();
}

function getExplicitAddress(ecosystem: AssociatedEcosystem): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(ecosystem === 'EVM' ? EXPLICIT_EVM_KEY : EXPLICIT_SOL_KEY);
  } catch {
    return null;
  }
}

export type SelectionMode = 'auto' | 'manual' | 'none';

export interface EcosystemSelection {
  /** The deterministic selected address, or null when explicit choice is required. */
  selected: string | null;
  mode: SelectionMode;
  count: number;
}

/**
 * Deterministic per-ecosystem selection (no second state system):
 * - exactly ONE associated wallet → auto-selected (persisted as preferred
 *   so every consumer agrees, no extra clicks needed);
 * - TWO OR MORE → the stored explicit preferred address, or null when none
 *   was chosen yet (never silently pick one);
 * - preferred address that is no longer associated → ignored (null unless
 *   the single-remaining rule applies).
 */
export function resolveSelection(ecosystem: AssociatedEcosystem, list: AssociatedWallet[]): EcosystemSelection {
  const group = list.filter((w) => w.ecosystem === ecosystem);
  if (group.length === 1) {
    const only = group[0].address;
    const pref = getPreferredAddress(ecosystem);
    if (!pref || pref.toLowerCase() !== only.toLowerCase()) {
      setPreferredAddress(only, ecosystem);
    }
    return { selected: only, mode: 'auto', count: 1 };
  }
  if (group.length === 0) return { selected: null, mode: 'none', count: 0 };
  // Two or more: ONLY an explicit user choice counts. A previously
  // auto-persisted ACTIVE_* value is not a choice — never silently keep it.
  const explicit = getExplicitAddress(ecosystem);
  const match = explicit
    ? group.find((w) => w.address.toLowerCase() === explicit.toLowerCase()) ?? null
    : null;
  return { selected: match ? match.address : null, mode: match ? 'manual' : 'none', count: group.length };
}

const CHANGED_EVENT = 'kipramp:wallets-changed';

function emitChanged(): void {
  if (typeof window === 'undefined') return;
  try {
    // Deferred: resolveSelection may persist during render, and listeners
    // must never run setState synchronously inside another render.
    void Promise.resolve().then(() => {
      try {
        window.dispatchEvent(new CustomEvent(CHANGED_EVENT));
      } catch {
        /* ignore */
      }
    });
  } catch {
    /* ignore */
  }
}

export function notifyWalletsChanged(): void {
  emitChanged();
}
