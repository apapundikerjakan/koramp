/**
 * Shared Support helpers — single source of truth for status workflow,
 * validation limits, and wallet-ownership checks.
 * Wallet-first: wallet address IS customer identity (no users table).
 */

export const SUPPORT_STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'WAITING_CUSTOMER',
  'RESOLVED',
  'CLOSED',
] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

export const SUPPORT_SENDERS = ['CUSTOMER', 'ADMIN'] as const;
export type SupportSender = (typeof SUPPORT_SENDERS)[number];

export const SUPPORT_MESSAGE_MIN = 1;
export const SUPPORT_MESSAGE_MAX = 4000;
export const SUPPORT_SUBJECT_MIN = 3;
export const SUPPORT_SUBJECT_MAX = 200;

export const EVM_RE = /^0x[a-fA-F0-9]{40}$/;
export const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isValidWalletForType(addr: string, type: string): boolean {
  return type === 'EVM' ? EVM_RE.test(addr) : type === 'SOLANA' ? SOL_RE.test(addr) : false;
}

export function sameWallet(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function shortWallet(addr: string): string {
  if (!addr) return '—';
  return addr.length <= 14 ? addr : `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/** Customer reply on WAITING_CUSTOMER reopens work. Admin reply on OPEN starts work. */
export function nextStatusOnMessage(current: string, sender: SupportSender): string | null {
  if (sender === 'CUSTOMER' && current === 'WAITING_CUSTOMER') return 'IN_PROGRESS';
  if (sender === 'ADMIN' && current === 'OPEN') return 'IN_PROGRESS';
  return null;
}

export function isTerminalStatus(s: string): boolean {
  return s === 'RESOLVED' || s === 'CLOSED';
}

/** Statuses that need admin attention for badge/count. */
export function needsAdminAttention(s: string): boolean {
  return s === 'OPEN' || s === 'IN_PROGRESS';
}
