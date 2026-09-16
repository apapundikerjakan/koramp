import clsx from 'clsx';

type StatusMap = Record<string, { label: string; className: string }>;

const TOP_UP_STATUS: StatusMap = {
  CREATED: { label: 'Created', className: 'badge-info' },
  PAYMENT_PENDING: { label: 'Awaiting Payment', className: 'badge-warning' },
  PAYMENT_CONFIRMED: { label: 'Payment Confirmed', className: 'badge-success' },
  CRYPTO_PROCESSING: { label: 'Processing', className: 'badge-warning' },
  CRYPTO_SENT: { label: 'Crypto Sent', className: 'badge-purple' },
  COMPLETED: { label: 'Completed', className: 'badge-success' },
  PAYMENT_FAILED: { label: 'Payment Failed', className: 'badge-error' },
  CRYPTO_FAILED: { label: 'Failed', className: 'badge-error' },
  CANCELLED: { label: 'Cancelled', className: 'badge-error' },
  EXPIRED: { label: 'Expired', className: 'badge-error' },
};

const SELL_STATUS: StatusMap = {
  CREATED: { label: 'Created', className: 'badge-info' },
  AWAITING_CRYPTO: { label: 'Awaiting Crypto', className: 'badge-warning' },
  CRYPTO_DETECTED: { label: 'Crypto Detected', className: 'badge-info' },
  CONFIRMING: { label: 'Confirming', className: 'badge-warning' },
  CRYPTO_CONFIRMED: { label: 'Crypto Confirmed', className: 'badge-success' },
  PAYOUT_PROCESSING: { label: 'Payout Processing', className: 'badge-warning' },
  PAYOUT_SENT: { label: 'Payout Sent', className: 'badge-purple' },
  COMPLETED: { label: 'Completed', className: 'badge-success' },
  EXPIRED: { label: 'Expired', className: 'badge-error' },
  CRYPTO_FAILED: { label: 'Crypto Failed', className: 'badge-error' },
  PAYOUT_FAILED: { label: 'Payout Failed', className: 'badge-error' },
  CANCELLED: { label: 'Cancelled', className: 'badge-error' },
};

interface StatusBadgeProps {
  status: string;
  type?: 'TOP_UP' | 'SELL';
}

export function StatusBadge({ status, type = 'TOP_UP' }: StatusBadgeProps) {
  const map = type === 'TOP_UP' ? TOP_UP_STATUS : SELL_STATUS;
  const info = map[status] ?? { label: status, className: 'badge-info' };

  return <span className={info.className}>{info.label}</span>;
}
