import { z } from 'zod';

/** Shared zod enums — previously duplicated in 6+ route files. */
export const AssetEnum = z.enum(['SOL', 'ETH', 'BNB']);
export const NetworkEnum = z.enum(['SOLANA', 'BASE', 'BSC']);
export const WalletTypeEnum = z.enum(['EVM', 'SOLANA']);
export type AssetEnumT = z.infer<typeof AssetEnum>;
export type NetworkEnumT = z.infer<typeof NetworkEnum>;

/** Shared pagination parser — clamps, never yields NaN skip. */
export function parsePagination(searchParams: URLSearchParams, maxLimit = 50) {
  const rawPage = Number(searchParams.get('page') ?? '1');
  const rawLimit = Number(searchParams.get('limit') ?? '20');
  const page = Number.isFinite(rawPage) ? Math.max(1, Math.floor(rawPage)) : 1;
  const limit = Number.isFinite(rawLimit)
    ? Math.min(maxLimit, Math.max(1, Math.floor(rawLimit)))
    : 20;
  return { page, limit };
}

/** Allowlisted order status filters. */
export const TopUpStatusEnum = z.enum([
  'CREATED', 'PAYMENT_PENDING', 'PAYMENT_CONFIRMED', 'PAYMENT_CREATE_UNKNOWN',
  'PAYMENT_CREATE_FAILED', 'CRYPTO_PROCESSING', 'COMPLETED', 'EXPIRED', 'FAILED',
]);
export const SellStatusEnum = z.enum([
  'CREATED', 'AWAITING_CRYPTO', 'CRYPTO_DETECTED', 'CONFIRMING',
  'CRYPTO_CONFIRMED', 'PAYOUT_PROCESSING', 'COMPLETED', 'EXPIRED', 'FAILED',
]);

export const SIMULATE_PROVIDERS = [
  'shopeepay', 'gopay', 'ovo', 'dana', 'bca', 'bri', 'mandiri', 'bni', 'qris',
] as const;
export const SimulateProviderEnum = z.enum(SIMULATE_PROVIDERS);
