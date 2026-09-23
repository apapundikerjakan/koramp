import type { BlockchainProvider } from './types';
import { createMockProvider } from './mock';
import { baseProvider, bscProvider } from './evm';
import { solanaProvider } from './solana';

export type NetworkId = 'SOLANA' | 'BASE' | 'BSC';

export function getBlockchainProvider(network: NetworkId): BlockchainProvider {
  const type = process.env.BLOCKCHAIN_PROVIDER ?? 'mock';
  if (type !== 'mock' && type !== 'real') {
    throw new Error(
      `[blockchain] Invalid BLOCKCHAIN_PROVIDER "${type}". Expected 'mock' or 'real'.`,
    );
  }

  // Fail-closed in production: mock provider must never serve real traffic.
  if (process.env.NODE_ENV === 'production' && type !== 'real') {
    throw new Error(
      '[blockchain] BLOCKCHAIN_PROVIDER must be "real" in production (mock would return fake balances/transactions)',
    );
  }

  if (type === 'mock') {
    return createMockProvider(network);
  }

  // Real providers
  switch (network) {
    case 'SOLANA': return solanaProvider;
    case 'BASE':   return baseProvider;
    case 'BSC':    return bscProvider;
    default:
      throw new Error(`Unknown network: ${network}`);
  }
}

export type { BlockchainProvider } from './types';
