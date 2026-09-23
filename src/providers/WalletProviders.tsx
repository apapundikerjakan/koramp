'use client';

/**
 * WalletProviders — ONE provider boundary for the public wallet experience.
 *
 * Wraps PUBLIC wallet routes only (see src/app/(public)/layout.tsx).
 * Must NEVER be mounted in root layout or admin routes.
 *
 * Architecture (final — RainbowKit native):
 *   WalletProviders
 *   ├── WagmiProvider (RainbowKit-configured connectors)
 *   │    └── QueryClientProvider (single QueryClient)
 *   │         └── RainbowKitProvider (dark theme; NATIVE RainbowKit modal —
 *   │              no custom wallet list/popup for EVM)
 *   ├── ConnectionProvider + SolanaWalletProvider (Phantom/Solflare/Backpack, direct adapters)
 *   │    └── WalletModalProvider (OFFICIAL Solana modal — no custom Solana list)
 *   └── KiprampWalletProvider (unified state bridge: EVM + Solana simultaneously;
 *        transaction-signing layer for topup/sell — logic untouched)
 *
 * EVM connection UI is 100% RainbowKit (<ConnectButton /> + native modal).
 * Solana connection UI is 100% official wallet-adapter modal, opened via
 * SolanaModalBridge whenever legacy `setShowConnectModal(true)` callers
 * (topup/sell pages) request a Solana wallet.
 */

import React, { useMemo, useEffect } from 'react';
import { WagmiProvider, createConfig, http } from 'wagmi';
import {
  baseSepolia, bscTestnet,
} from 'wagmi/chains';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, connectorsForWallets, darkTheme } from '@rainbow-me/rainbowkit';
import {
  metaMaskWallet,
  rabbyWallet,
  coinbaseWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets';
import {
  ConnectionProvider,
  WalletProvider as SolanaWalletProvider,
} from '@solana/wallet-adapter-react';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import { BackpackWalletAdapter } from '@solana/wallet-adapter-backpack';
import { clusterApiUrl } from '@solana/web3.js';
import { WalletModalProvider, useWalletModal } from '@solana/wallet-adapter-react-ui';
import { WalletProvider as KiprampWalletProvider, useWallet } from '@/contexts/WalletContext';
import { Toaster } from 'sonner';

/**
 * SolanaModalBridge — opens the OFFICIAL Solana wallet modal whenever
 * legacy callers request it via `setShowConnectModal(true)` (topup/sell
 * pages). No custom wallet list is rendered anywhere.
 */
function SolanaModalBridge() {
  const { showConnectModal, setShowConnectModal } = useWallet();
  const { setVisible } = useWalletModal();
  useEffect(() => {
    if (showConnectModal) {
      setVisible(true);
      setShowConnectModal(false);
    }
  }, [showConnectModal, setVisible, setShowConnectModal]);
  return null;
}

// ── QueryClient (single instance) ─────────────────────────────────────────────
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

// ── RPC resolution (frontend) ─────────────────────────────────────────────────

const isProd = process.env.NODE_ENV === 'production';

/**
 * Resolve a public RPC URL for the browser.
 * Custom RPC first, documented high-rate-limit default second, with a loud
 * console warning in production so a missing env var can never go unnoticed.
 */
function resolvePublicRpc(
  custom: string | undefined,
  fallback: string,
  label: string,
): string {
  const trimmed = custom?.trim();
  if (trimmed) return trimmed;
  if (isProd) {
    // eslint-disable-next-line no-console
    console.warn(
      `[wallet] ${label} is not set — falling back to public RPC ${fallback}. ` +
        `Balance checks may be rate-limited. Set it in your environment (see .env.example).`,
    );
  }
  return fallback;
}

const DEFAULT_BASE_RPC = 'https://sepolia.base.org';
const DEFAULT_BSC_RPC  = 'https://data-seed-prebsc-1-s1.binance.org:8545';

const basePublicRpc = resolvePublicRpc(
  process.env.NEXT_PUBLIC_BASE_RPC_URL,
  DEFAULT_BASE_RPC,
  'NEXT_PUBLIC_BASE_RPC_URL',
);
const bscPublicRpc = resolvePublicRpc(
  process.env.NEXT_PUBLIC_BSC_RPC_URL,
  'https://bsc-dataseed.binance.org',
  'NEXT_PUBLIC_BSC_RPC_URL',
);
const solanaPublicRpc = resolvePublicRpc(
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
  clusterApiUrl(isProd ? 'mainnet-beta' : 'devnet'),
  'NEXT_PUBLIC_SOLANA_RPC_URL',
);
const wcProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '';

// One-time startup log so the active RPCs are verifiable in the browser console.
// Logged once per page load (helps confirm .env values actually reach the client).
if (typeof window !== 'undefined') {
  // eslint-disable-next-line no-console
  console.info(
    '[wallet] RPC endpoints → ' +
      `Base: ${basePublicRpc} | BSC: ${bscPublicRpc} | Solana: ${solanaPublicRpc}` +
      (wcProjectId ? '' : ' | WalletConnect: NOT CONFIGURED'),
  );
}

/**
 * Connector construction must never run on the server: WalletConnect's
 * provider eagerly touches `indexedDB` (unavailable in SSR → crash).
 * Fix: build per-environment — empty on the server, RainbowKit-backed
 * in the browser. The modal only renders client-side, so this is
 * invisible to users and fixes SSR cleanly.
 */
const isServer = typeof window === 'undefined';

function buildConnectors() {
  if (isServer) return []; // SSR — never construct wallet connectors
  const wallets = [
    metaMaskWallet,
    rabbyWallet,
    coinbaseWallet,
    ...(wcProjectId ? [walletConnectWallet] : []),
  ];
  return connectorsForWallets(
    [{ groupName: 'EVM', wallets }],
    { appName: 'KORAMP', projectId: wcProjectId || 'ONLY_WALLETCONNECT_NEEDS_PROJECT_ID' },
  );
}

const wagmiConfig = createConfig({
  // Kategori network: EVM (testnet project) + Solana (adapter, di bawah).
  // Ramp (Top Up/Sell) hanya didukung di Solana, Base, BNB Chain — lihat
  // RAMP_NETWORK_IDS di lib/assets. Chain di luar itu sengaja tidak
  // didaftarkan agar tidak muncul di RainbowKit dan tak bisa masuk flow Ramp.
  chains: [baseSepolia, bscTestnet],
  transports: {
    [baseSepolia.id]: http(basePublicRpc),
    [bscTestnet.id]: http(bscPublicRpc),
  },
  connectors: buildConnectors(),
  ssr: true,
});

// ── Solana wallets (direct adapters, no aggregator) ──────────────────────────
// Only instantiate on client; these are excluded from SSR bundle via next.config.js
function getSolanaWallets() {
  return [
    new PhantomWalletAdapter(),
    new SolflareWalletAdapter(),
    new BackpackWalletAdapter(),
  ];
}

// ── Provider tree (single boundary, no duplicates) ────────────────────────────

export function WalletProviders({ children }: { children: React.ReactNode }) {
  // Wallet adapters read process.env at construction time. When it is set
  // (e.g. NEXT_PUBLIC_SOLANA_RPC_URL via .env), pass it through; otherwise
  // fall back to a network-consistent default (dev in dev, mainnet in prod).
  const solanaEndpoint = solanaPublicRpc;

  // Memoize wallet list so adapters aren't re-created on every render
  const solanaWallets = useMemo(() => getSolanaWallets(), []);

  // DEV/STAGING GUARD: in production, block connections to a devnet endpoint.
  // Refuse to render the wallet layer rather than risk users signing devnet
  // transactions thinking they are on mainnet.
  useEffect(() => {
    if (isProd && solanaPublicRpc.includes('devnet')) {
      // eslint-disable-next-line no-console
      console.error(
        '[wallet] FATAL: NEXT_PUBLIC_SOLANA_RPC_URL points at devnet in production. ' +
          'Wallet layer disabled to prevent cross-network fund loss.',
      );
    }
  }, []);

  if (isProd && solanaPublicRpc.includes('devnet')) {
    // FATAL config error: production points at devnet. Render a static
    // notice WITHOUT any wallet providers or children — hooks like
    // useAccount/useWallet would throw outside their providers
    // (WagmiProviderNotFoundError → 500 on every public page).
    return (
      <div className="min-h-screen bg-base flex items-center justify-center px-4">
        <div className="w-full max-w-md text-center bg-surface-2 border border-red-500/30 rounded-xl p-8">
          <p className="text-red-400 text-xs font-bold tracking-widest mb-2">CONFIGURATION ERROR</p>
          <h1 className="text-white font-bold text-lg mb-2">Wallet Unavailable</h1>
          <p className="text-gray-400 text-sm leading-relaxed">
            Server dikonfigurasi ke jaringan test (devnet) di production.
            Hubungi administrator untuk memperbaikinya.
          </p>
        </div>
      </div>
    );
  }

  return (
    <WagmiProvider config={wagmiConfig} reconnectOnMount>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({ accentColor: '#C8A97E', accentColorForeground: 'white', borderRadius: 'medium' })}
          modalSize="compact"
        >
          <ConnectionProvider endpoint={solanaEndpoint}>
            <SolanaWalletProvider wallets={solanaWallets} autoConnect>
              <WalletModalProvider>
                {/* KORAMP unified wallet context reads from wagmi + wallet-adapter */}
                <KiprampWalletProvider>
                  {children}
                  <SolanaModalBridge />
                <Toaster
                  position="top-right"
                  theme="dark"
                  toastOptions={{
                    style: { background: '#182019', border: '1px solid #2C3A2E', color: '#fff' },
                  }}
                />
              </KiprampWalletProvider>
              </WalletModalProvider>
            </SolanaWalletProvider>
          </ConnectionProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
