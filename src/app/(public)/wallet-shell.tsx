'use client';

import { WalletProviders } from '@/providers/WalletProviders';

/**
 * Client-only mount point for the wallet graph.
 *
 * Imported via next/dynamic with ssr:false from the (public) server layout,
 * so the wagmi/RainbowKit/Solana ESM graph NEVER enters the server module
 * graph (its SSR evaluation 500s every public route on this toolchain —
 * "Element type is invalid: got undefined", dev and prod, pre-existing).
 */
export function WalletShell({ children }: { children: React.ReactNode }) {
  return <WalletProviders>{children}</WalletProviders>;
}
