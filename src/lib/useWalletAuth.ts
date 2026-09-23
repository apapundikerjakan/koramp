'use client';

/**
 * useWalletAuth — client side of challenge/response wallet proof.
 *
 * Tokens are cached in MEMORY ONLY (never localStorage: XSS must not be able
 * to steal a reusable credential from disk). 15-min server TTL; callers retry
 * once after clearing on 401.
 */

import { useCallback } from 'react';
import type { WalletEcosystem, WalletPurpose } from '@/lib/walletAuth';

interface Cached {
  token: string;
  exp: number;
}

const cache = new Map<string, Cached>();

function keyFor(walletAddress: string, purpose: WalletPurpose): string {
  return `${walletAddress.toLowerCase()}:${purpose}`;
}

export function clearWalletToken(walletAddress: string, purpose: WalletPurpose): void {
  cache.delete(keyFor(walletAddress, purpose));
}

async function postJson(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { error?: { message?: string } };
  if (!res.ok) throw new Error(data.error?.message ?? `Request gagal (${res.status})`);
  return data;
}

/**
 * Get a valid session token, signing a fresh challenge if needed.
 * `sign` must open the wallet's signing prompt for the exact message.
 */
export async function getWalletToken(args: {
  walletAddress: string;
  ecosystem: WalletEcosystem;
  purpose: WalletPurpose;
  sign: (message: string) => Promise<string>;
}): Promise<string> {
  const { walletAddress, ecosystem, purpose, sign } = args;
  const k = keyFor(walletAddress, purpose);
  const hit = cache.get(k);
  if (hit && hit.exp - Date.now() > 60_000) return hit.token;

  const ch = (await postJson('/api/wallets/challenge', { walletAddress, ecosystem, purpose })) as {
    challengeId: string;
    message: string;
    expiresAt: number;
  };
  let signature: string;
  try {
    signature = await sign(ch.message);
  } catch {
    throw new Error('Tanda tangan dibatalkan. Verifikasi wallet diperlukan.');
  }
  const ver = (await postJson('/api/wallets/verify', { challengeId: ch.challengeId, signature })) as {
    token: string;
    expiresAt: number;
  };
  cache.set(k, { token: ver.token, exp: ver.expiresAt });
  return ver.token;
}

export function useWalletAuth() {
  const getToken = useCallback(
    (args: { walletAddress: string; ecosystem: WalletEcosystem; purpose: WalletPurpose; sign: (message: string) => Promise<string> }) =>
      getWalletToken(args),
    [],
  );
  return { getToken, clearToken: clearWalletToken };
}
