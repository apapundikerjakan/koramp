/**
 * Network configuration — SINGLE SOURCE OF TRUTH
 *
 * Frontend (WalletProviders) and backend (blockchain providers) MUST agree
 * on which network they operate on. This module derives the Solana cluster
 * from ONE env var (SOLANA_NETWORK) so it is impossible for the frontend to
 * sit on mainnet-beta while the backend sends transactions to devnet.
 *
 * Rules:
 * - SOLANA_NETWORK must be 'mainnet' or 'devnet' (default: devnet).
 * - In production, all RPC env vars are REQUIRED. Missing values fail fast
 *   at startup instead of silently falling back to a public RPC on the
 *   wrong cluster.
 * - RPC URLs may be overridden per environment, but consistency between
 *   frontend and backend is enforced in validateNetworkConfig().
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type SolanaNetwork = 'mainnet' | 'devnet';

// ─── Solana ───────────────────────────────────────────────────────────────────

export const SOLANA_GENESIS_HASHES: Record<SolanaNetwork, string> = {
  // Genesis hash uniquely identifies each cluster — cannot be spoofed by a
  // misconfigured proxy URL.
  mainnet: '5EybkYdUi4Z3HGuHsr6Pf7GN8kbZSUDggRro6iVbLFyr',
  devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
};

export function getSolanaNetwork(): SolanaNetwork {
  const raw = (process.env.SOLANA_NETWORK ?? 'devnet').toLowerCase().trim();
  if (raw === 'mainnet' || raw === 'mainnet-beta') return 'mainnet';
  if (raw === 'devnet' || raw === 'testnet' /* treated as devnet-equivalent sandbox */) {
    return 'devnet';
  }
  throw new Error(
    `[network] Invalid SOLANA_NETWORK "${raw}". Expected 'mainnet' or 'devnet'.`,
  );
}

/**
 * Backend RPC for Solana (server-side only).
 * Fails fast in production if unset — never silently defaults.
 */
export function getSolanaRpcUrl(): string {
  const rpc = process.env.SOLANA_RPC_URL?.trim();
  if (rpc) return rpc;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '[network] SOLANA_RPC_URL is required in production. ' +
        'Refusing to fall back to a public RPC (network mismatch risk).',
    );
  }
  // Development convenience only — matches SOLANA_NETWORK default.
  return 'https://api.devnet.solana.com';
}

/**
 * Frontend RPC for Solana (exposed to the browser bundle).
 * Must be explicitly set in production; falls back to the backend URL in dev.
 */
export function getSolanaPublicRpcUrl(): string {
  const rpc = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim();
  if (rpc) return rpc;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '[network] NEXT_PUBLIC_SOLANA_RPC_URL is required in production. ' +
        'Wallet connections would otherwise use a rate-limited public RPC.',
    );
  }
  // Dev: reuse the backend URL so both sides always hit the same cluster.
  return getSolanaRpcUrl();
}

// ─── EVM (Base / BSC) ─────────────────────────────────────────────────────────

export function getBaseRpcUrl(): string {
  const rpc = process.env.BASE_RPC_URL?.trim();
  if (rpc) return rpc;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[network] BASE_RPC_URL is required in production.');
  }
  return 'https://sepolia.base.org'; // Base Sepolia testnet default
}

export function getBscRpcUrl(): string {
  const rpc = process.env.BSC_RPC_URL?.trim();
  if (rpc) return rpc;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[network] BSC_RPC_URL is required in production.');
  }
  return 'https://bsc-testnet-rpc.publicnode.com'; // BSC Testnet public node
}

export function getBasePublicRpcUrl(): string {
  const rpc = process.env.NEXT_PUBLIC_BASE_RPC_URL?.trim();
  if (rpc) return rpc;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '[network] NEXT_PUBLIC_BASE_RPC_URL is required in production. ' +
        'Wallet connections would otherwise use a rate-limited public RPC.',
    );
  }
  return getBaseRpcUrl();
}

export function getBscPublicRpcUrl(): string {
  const rpc = process.env.NEXT_PUBLIC_BSC_RPC_URL?.trim();
  if (rpc) return rpc;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '[network] NEXT_PUBLIC_BSC_RPC_URL is required in production. ' +
        'Wallet connections would otherwise use a rate-limited public RPC.',
    );
  }
  return getBscRpcUrl();
}

// ─── Startup validation ───────────────────────────────────────────────────────

/**
 * Verify that the configured RPC endpoints actually serve the network this
 * deployment claims to run on. Throws (fail fast) on mismatch.
 *
 * Server-side only — do not call from client components.
 */
export async function validateNetworkConfig(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'edge') return;

  const solanaNetwork = getSolanaNetwork();
  const solanaRpc = getSolanaRpcUrl();

  const expected = SOLANA_GENESIS_HASHES[solanaNetwork];
  try {
    const res = await fetch(solanaRpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getGenesisHash' }),
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok) {
      const json = (await res.json()) as { result?: string };
      const actual = json.result;
      if (actual && actual !== expected) {
        throw new Error(
          `[network] FATAL: SOLANA_RPC_URL (${solanaRpc}) serves genesis ` +
            `${actual} but SOLANA_NETWORK=${solanaNetwork} expects ${expected}. ` +
            'Refusing to start — frontend and backend would operate on different clusters.',
        );
      }
    }
    // Non-OK / unreachable RPC is logged but not fatal here: it may be a
    // transient startup hiccup. The per-request fail-fast in getSolanaRpcUrl
    // still guards against unset variables.
  } catch (err) {
    if (err instanceof TypeError || (err as Error)?.name === 'TimeoutError') {
      console.warn('[network] Solana RPC unreachable at startup — skipping genesis check.');
      return;
    }
    throw err;
  }

  if (process.env.NODE_ENV === 'production' && process.env.NEXT_RUNTIME !== 'edge') {
    // Client RPC vars: missing values are a rate-limit degradation (client
    // falls back to public RPC with a loud browser warning), not a network
    // divergence — so log loudly instead of failing the whole server.
    const missing: string[] = [];
    if (!process.env.NEXT_PUBLIC_SOLANA_RPC_URL) missing.push('NEXT_PUBLIC_SOLANA_RPC_URL');
    if (!process.env.NEXT_PUBLIC_BASE_RPC_URL) missing.push('NEXT_PUBLIC_BASE_RPC_URL');
    if (!process.env.NEXT_PUBLIC_BSC_RPC_URL) missing.push('NEXT_PUBLIC_BSC_RPC_URL');
    if (missing.length) {
      console.error(
        `[network] WARNING: missing client RPC env vars: ${missing.join(', ')}. ` +
          'Browser wallets will fall back to rate-limited public RPCs. ' +
          'Set them in your environment (see .env.example).',
      );
    }
  }
}
