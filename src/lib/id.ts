import { randomBytes } from 'crypto';

/** Generate opaque public order token, e.g. "krm_a8f3x2p9" */
export function generatePublicId(prefix = 'krm'): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

/** Generate human-readable order number, e.g. "KRM-ABC12-3XYZ" */
export function generateOrderNumber(): string {
  const ts = Date.now().toString(36).toUpperCase();
  // 6 byte = 12 hex characters = 16^12 ≈ 2.8×10^14 kemungkinan
  // Lebih sulit diprediksi dibanding 3 byte (4096 kemungkinan)
  const rnd = randomBytes(6).toString('hex').toUpperCase();
  return `KRM-${ts}-${rnd}`;
}
