/** Privacy helpers — single maskAccount used by all order/payout views. */
export function maskAccount(acc: string | null | undefined): string | null {
  if (!acc) return null;
  const s = String(acc);
  if (s.length <= 4) return '****';
  return `****${s.slice(-4)}`;
}

/** Statuses where QR payload may still be exposed. */
const QR_VISIBLE = new Set(['PAYMENT_PENDING', 'CREATED', 'PAYMENT_CREATE_UNKNOWN']);
export function qrVisibleForStatus(status: string): boolean {
  return QR_VISIBLE.has(status);
}
