'use client';

/**
 * Kipramp Wallet Context — Dual Wallet Support
 *
 * Supports EVM (wagmi v2) and Solana (@solana/wallet-adapter-react)
 * SIMULTANEOUSLY. Both wallets can be connected at the same time.
 *
 * Key design decisions:
 * - Exposes per-ecosystem state: evmAddress, solAddress, evmConnected, solConnected
 * - `address` / `ecosystem` / `network` resolve based on asset context (sell/topup page)
 * - `sendCrypto` routes by asset type, not arbitrary priority
 * - `disconnectEvm` and `disconnectSol` work independently
 * - Modal does NOT auto-close when one wallet connects — stays open for second
 */

import React, {
  createContext, useContext, useState, useCallback, useEffect, useMemo, useRef,
} from 'react';
import {
  useAccount, useConnect, useDisconnect, useSwitchChain,
  useChainId, useSendTransaction, type Connector,
} from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { parseEther } from 'viem';
import { useWallet as useSolanaWallet, useConnection as useSolanaConnection } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import {
  SUPPORTED_ASSETS, CHAIN_ID_TO_ASSET, EVM_CHAIN_ADD_PARAMS,
  isSupportedEvmChainId,
  type AssetSymbol, type NetworkId, type WalletEcosystem,
} from '@/lib/assets';

// ─── Types ────────────────────────────────────────────────────────────────────

export type WalletStatus = 'disconnected' | 'connecting' | 'connected' | 'wrong_network' | 'error';

export interface KiprampWalletState {
  // ── Global state ────────────────────────────────────────────────────────────
  status: WalletStatus;
  isConnected: boolean;   // true if either wallet is connected
  isConnecting: boolean;

  // ── EVM wallet ──────────────────────────────────────────────────────────────
  evmConnected: boolean;
  evmAddress: string | null;
  evmChainId: number | null;
  evmWalletName: string | null;
  evmWrongNetwork: boolean;

  // ── Solana wallet ───────────────────────────────────────────────────────────
  solConnected: boolean;
  solAddress: string | null;
  solWalletName: string | null;

  // ── Legacy single-wallet fields (for backwards compat with pages) ────────
  // Resolve based on which ecosystem the current page/action needs
  address: string | null;        // active address for current operation
  ecosystem: WalletEcosystem | null;
  network: NetworkId | null;
  chainId: number | null;
  walletName: string | null;
  walletType: 'EVM' | 'SOLANA' | null;

  // ── UI ──────────────────────────────────────────────────────────────────────
  /** Open RainbowKit's native EVM connect modal (MetaMask/Rabby/WC/Coinbase). */
  openEvmModal: () => void;
  /** Show/hide the Solana-only wallet modal (Phantom/Solflare/Backpack). */
  showConnectModal: boolean;
  setShowConnectModal: (v: boolean) => void;
  error: string | null;
  setError: (message: string | null) => void;

  // ── Actions ─────────────────────────────────────────────────────────────────
  connectEvm: (connector: Connector) => void;
  disconnectEvm: () => void;
  disconnectSol: () => Promise<void>;
  disconnect: () => Promise<void>;          // disconnects both
  switchToChain: (chainId: number) => Promise<boolean>;
  /**
   * Auto-detect + auto-switch: pastikan EVM wallet ada di chain yang
   * dibutuhkan asset (minta switch ke wallet user, tambah chain bila belum ada).
   * Return true bila sudah/sesuai; false bila user menolak / gagal.
   * Untuk asset Solana selalu true (tidak ada chain EVM yang harus dicek).
   */
  ensureChainForAsset: (asset: AssetSymbol) => Promise<boolean>;

  /**
   * Send crypto. Routes to EVM or Solana based on asset type — explicit, not priority.
   */
  sendCrypto: (opts: { to: string; amount: string; asset: 'SOL' | 'ETH' | 'BNB' }) => Promise<string>;

  // ── Validation helpers ──────────────────────────────────────────────────────
  isCorrectNetworkForAsset: (asset: AssetSymbol) => boolean;
  getRequiredNetworkName: (asset: AssetSymbol) => string;
  getRequiredChainId: (asset: AssetSymbol) => number | null;
  shortAddress: (ecosystem?: WalletEcosystem) => string;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const WalletCtx = createContext<KiprampWalletState | null>(null);

/**
 * SSR-tolerant disconnected defaults.
 *
 * Public pages SSR-prerender without the wallet graph mounted (the providers
 * boundary is client-only — see (public)/layout). Returning defaults instead
 * of throwing keeps SSR shells renderable; the client hydrates with live
 * state immediately after. Misuse outside any provider is still surfaced
 * via a dev-only browser warning.
 */
const DISCONNECTED_WALLET: KiprampWalletState = {
  status: 'disconnected',
  isConnected: false,
  isConnecting: false,
  evmConnected: false,
  evmAddress: null,
  evmChainId: null,
  evmWalletName: null,
  evmWrongNetwork: false,
  solConnected: false,
  solAddress: null,
  solWalletName: null,
  address: null,
  ecosystem: null,
  network: null,
  chainId: null,
  walletName: null,
  walletType: null,
  openEvmModal: () => {},
  showConnectModal: false,
  setShowConnectModal: () => {},
  error: null,
  setError: () => {},
  connectEvm: () => {},
  disconnectEvm: () => {},
  disconnectSol: async () => {},
  disconnect: async () => {},
  switchToChain: async () => false,
  ensureChainForAsset: async () => false,
  sendCrypto: async () => {
    throw new Error('Wallet belum terhubung. Hubungkan wallet dulu.');
  },
  isCorrectNetworkForAsset: () => false,
  getRequiredNetworkName: () => '',
  getRequiredChainId: () => null,
  shortAddress: () => '',
};

export function useWallet(): KiprampWalletState {
  const ctx = useContext(WalletCtx);
  if (!ctx) {
    if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn('[wallet] useWallet outside WalletProvider — disconnected defaults (SSR shell?)');
    }
    return DISCONNECTED_WALLET;
  }
  return ctx;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // RainbowKit's native EVM connect modal — opens popup with MetaMask/Rabby/WC/Coinbase
  const { openConnectModal } = useConnectModal();
  const openEvmModal = useCallback(() => {
    openConnectModal?.();
  }, [openConnectModal]);

  // Solana connection from ConnectionProvider (correct RPC, no 403)
  const { connection: solanaConnection } = useSolanaConnection();

  // ── EVM ───────────────────────────────────────────────────────────────────
  const { address: _evmAddress, isConnected: _evmConnected, connector: evmConnector } = useAccount();
  const { disconnect: wagmiDisconnect } = useDisconnect();
  // NOTE: pakai switchChainAsync (promise) — bukan switchChain (mutate tanpa
  // promise) — supaya reject (user menolak / chain belum ada) bisa di-catch.
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain();
  const { connect: wagmiConnect, isPending: isEvmConnectPending } = useConnect();
  const _evmChainId = useChainId();
  const { sendTransactionAsync } = useSendTransaction();

  // ── Solana ────────────────────────────────────────────────────────────────
  const {
    connected: _solConnected,
    publicKey,
    wallet: solWallet,
    disconnect: solDisconnect,
    connecting: solConnecting,
    sendTransaction: solSendTransaction,
  } = useSolanaWallet();

  // Stable refs for connection-lost detection
  const prevEvmAddressRef = useRef<string | null>(_evmAddress ?? null);

  useEffect(() => {
    prevEvmAddressRef.current = _evmAddress ?? null;
  }, [_evmAddress]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const evmConnected  = _evmConnected && !!_evmAddress;
  const evmAddress    = _evmAddress ?? null;
  const evmChainId    = _evmConnected ? _evmChainId : null;
  const evmWalletName = evmConnected && evmConnector ? evmConnector.name : null;
  const evmWrongNetwork = evmConnected && evmChainId != null
    && !isSupportedEvmChainId(evmChainId);

  const solConnected  = _solConnected && !!publicKey;
  const solAddress    = publicKey ? publicKey.toBase58() : null;
  const solWalletName = solConnected && solWallet ? solWallet.adapter.name : null;

  // Global status
  const isConnecting = solConnecting || isSwitching || isEvmConnectPending;
  const isConnected  = evmConnected || solConnected;

  const status = useMemo<WalletStatus>(() => {
    if (isConnecting) return 'connecting';
    if (evmConnected && evmWrongNetwork) return 'wrong_network';
    if (isConnected) return 'connected';
    return 'disconnected';
  }, [isConnecting, evmConnected, evmWrongNetwork, isConnected]);

  // Legacy single-address fields — resolve based on which is available
  // Pages that need a specific ecosystem should use evmAddress/solAddress directly
  const address = useMemo<string | null>(() => {
    if (evmConnected) return evmAddress;
    if (solConnected) return solAddress;
    return null;
  }, [evmConnected, evmAddress, solConnected, solAddress]);

  const ecosystem = useMemo<WalletEcosystem | null>(() => {
    if (evmConnected && solConnected) return null; // both connected — no single ecosystem
    if (evmConnected) return 'EVM';
    if (solConnected) return 'SOLANA';
    return null;
  }, [evmConnected, solConnected]);

  const network = useMemo<NetworkId | null>(() => {
    if (evmConnected && evmChainId) {
      return CHAIN_ID_TO_ASSET[evmChainId]?.networkId ?? null;
    }
    if (solConnected) return 'SOLANA';
    return null;
  }, [evmConnected, evmChainId, solConnected]);

  const walletName = useMemo<string | null>(() => {
    if (evmConnected) return evmWalletName;
    if (solConnected) return solWalletName;
    return null;
  }, [evmConnected, evmWalletName, solConnected, solWalletName]);

  const walletType = useMemo<'EVM' | 'SOLANA' | null>(() => {
    if (evmConnected && !solConnected) return 'EVM';
    if (solConnected && !evmConnected) return 'SOLANA';
    return null; // both connected
  }, [evmConnected, solConnected]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const mapWalletError = useCallback((err: unknown, fallback: string): string => {
    const msg = err instanceof Error ? err.message : String(err ?? '');
    const lower = msg.toLowerCase();
    if (lower.includes('rejected') || lower.includes('denied')) {
      return 'Koneksi dibatalkan. Silakan approve di wallet Anda.';
    }
    return `${fallback} ${msg.slice(0, 80)}`.trim();
  }, []);

  const connectEvm = useCallback((connector: Connector) => {
    setError(null);
    wagmiConnect(
      { connector },
      {
        onSuccess: () => setError(null),
        onError: (err) => setError(mapWalletError(err, 'Gagal connect wallet.')),
      },
    );
  }, [wagmiConnect, mapWalletError]);

  const disconnectEvm = useCallback(() => {
    wagmiDisconnect();
  }, [wagmiDisconnect]);

  const disconnectSol = useCallback(async () => {
    await solDisconnect().catch(() => {});
  }, [solDisconnect]);

  const disconnect = useCallback(async () => {
    if (evmConnected) wagmiDisconnect();
    if (solConnected) await solDisconnect().catch(() => {});
    setError(null);
  }, [evmConnected, wagmiDisconnect, solConnected, solDisconnect]);

  // ── Last good EVM chain (untuk auto-switch saat connect di network salah) ──
  const LAST_EVM_CHAIN_KEY = 'kipramp_last_evm_chain';

  const persistLastChain = useCallback((chainId: number) => {
    try {
      if (isSupportedEvmChainId(chainId)) {
        window.localStorage.setItem(LAST_EVM_CHAIN_KEY, String(chainId));
      }
    } catch { /* storage unavailable — abaikan */ }
  }, []);

  function readLastChain(): number | null {
    try {
      const v = Number(window.localStorage.getItem(LAST_EVM_CHAIN_KEY));
      return isSupportedEvmChainId(v) ? v : null;
    } catch {
      return null;
    }
  }

  /** True bila error berarti "chain belum ada di wallet" (perlu wallet_addEthereumChain). */
  function isChainMissingError(err: unknown): boolean {
    const code = (err as { code?: number })?.code
      ?? (err as { cause?: { code?: number } })?.cause?.code;
    if (code === 4902) return true;
    const msg = err instanceof Error ? err.message : String(err ?? '');
    return /4902|unrecognized chain|not been added|unknown chain|does not exist|missing/i.test(msg);
  }

  function describeSwitchError(err: unknown): string {
    const msg = err instanceof Error ? err.message : String(err ?? '');
    const lower = msg.toLowerCase();
    if (lower.includes('rejected') || lower.includes('denied') || lower.includes('user')) {
      return 'Network switch dibatalkan. Silakan approve di wallet.';
    }
    return `Gagal switch network: ${msg.slice(0, 80)}`;
  }

  const switchToChain = useCallback(async (targetChainId: number): Promise<boolean> => {
    if (!evmConnected) return false;
    if (evmChainId === targetChainId) {
      persistLastChain(targetChainId);
      return true;
    }
    // 1. Coba switch biasa (chain sudah ada di wallet).
    try {
      await switchChainAsync({ chainId: targetChainId });
      persistLastChain(targetChainId);
      setError(null);
      return true;
    } catch (err: unknown) {
      if (!isChainMissingError(err)) {
        setError(describeSwitchError(err));
        return false;
      }
      // 2. Chain belum ada di wallet (error 4902) → tambahkan dulu, lalu switch.
      try {
        const provider = (await evmConnector?.getProvider?.()) as
          | { request?: (args: { method: string; params?: unknown[] }) => Promise<unknown> }
          | undefined;
        const params = EVM_CHAIN_ADD_PARAMS[targetChainId];
        if (!provider?.request || !params) {
          throw new Error('wallet tidak mendukung penambahan network otomatis');
        }
        await provider.request({ method: 'wallet_addEthereumChain', params: [params] });
        await switchChainAsync({ chainId: targetChainId });
        persistLastChain(targetChainId);
        setError(null);
        return true;
      } catch (err2: unknown) {
        setError(describeSwitchError(err2));
        return false;
      }
    }
  }, [evmConnected, evmChainId, evmConnector, switchChainAsync, persistLastChain]);

  const ensureChainForAsset = useCallback(async (asset: AssetSymbol): Promise<boolean> => {
    const cfg = SUPPORTED_ASSETS[asset];
    if (!cfg || cfg.walletEcosystem !== 'EVM' || cfg.chainId == null) return true;
    if (!evmConnected) return false;
    if (evmChainId === cfg.chainId) {
      persistLastChain(cfg.chainId);
      return true;
    }
    return switchToChain(cfg.chainId);
  }, [evmConnected, evmChainId, switchToChain, persistLastChain]);

  // Ingat chain valid terakhir — jadi referensi auto-switch berikutnya.
  useEffect(() => {
    if (evmConnected && !evmWrongNetwork && evmChainId != null) {
      persistLastChain(evmChainId);
    }
  }, [evmConnected, evmWrongNetwork, evmChainId, persistLastChain]);

  // AUTO-DETECT + AUTO-SWITCH: wallet connect di network yang tidak didukung
  // (mis. Ethereum mainnet) → otomatis minta pindah ke chain terakhir yang
  // valid. Sekali per koneksi; bila user menolak, jangan paksa (tunggu aksi manual).
  const autoSwitchTriedRef = useRef(false);
  useEffect(() => {
    if (!evmConnected || !evmWrongNetwork) {
      autoSwitchTriedRef.current = false;
      return;
    }
  }, [evmConnected, evmWrongNetwork]);
  useEffect(() => {
    if (!evmConnected || !evmWrongNetwork || autoSwitchTriedRef.current) return;
    const last = readLastChain();
    if (last == null) return; // belum ada riwayat → biarkan UI manual yang memandu
    autoSwitchTriedRef.current = true;
    void switchToChain(last);
  }, [evmConnected, evmWrongNetwork, switchToChain]);

  const sendCrypto = useCallback(async (opts: {
    to: string;
    amount: string;
    asset: 'SOL' | 'ETH' | 'BNB';
  }): Promise<string> => {
    const { to, amount, asset } = opts;

    if (asset === 'SOL') {
      if (!solConnected || !publicKey || !solSendTransaction) {
        throw new Error('Solana wallet tidak terhubung. Hubungkan Phantom/Solflare terlebih dahulu.');
      }
      // Decimal → lamports with explicit FLOOR (P23, no parseFloat).
      const { default: Decimal } = await import('decimal.js');
      const lamports = new Decimal(amount).mul(LAMPORTS_PER_SOL).toDecimalPlaces(0, Decimal.ROUND_FLOOR).toNumber();
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: new PublicKey(to),
          lamports,
        }),
      );
      return await solSendTransaction(tx, solanaConnection);
    }

    if (asset === 'ETH' || asset === 'BNB') {
      if (!evmConnected || !evmAddress) {
        throw new Error('EVM wallet tidak terhubung. Hubungkan MetaMask/Rabby terlebih dahulu.');
      }
      const hash = await sendTransactionAsync({
        to: to as `0x${string}`,
        value: parseEther(amount),
      });
      return hash;
    }

    throw new Error(`Asset tidak dikenali: ${asset}`);
  }, [solConnected, publicKey, solSendTransaction, solanaConnection, evmConnected, evmAddress, sendTransactionAsync]);

  const isCorrectNetworkForAsset = useCallback((asset: AssetSymbol): boolean => {
    const cfg = SUPPORTED_ASSETS[asset];
    if (!cfg) return false;
    if (cfg.walletEcosystem === 'SOLANA') return solConnected;
    if (cfg.walletEcosystem === 'EVM') {
      return evmConnected && evmChainId === cfg.chainId;
    }
    return false;
  }, [solConnected, evmConnected, evmChainId]);

  const getRequiredNetworkName = useCallback((asset: AssetSymbol): string => {
    return SUPPORTED_ASSETS[asset]?.networkName ?? 'Unknown';
  }, []);

  const getRequiredChainId = useCallback((asset: AssetSymbol): number | null => {
    return SUPPORTED_ASSETS[asset]?.chainId ?? null;
  }, []);

  const shortAddress = useCallback((eco?: WalletEcosystem): string => {
    let addr: string | null = null;
    if (eco === 'EVM') addr = evmAddress;
    else if (eco === 'SOLANA') addr = solAddress;
    else addr = address; // fallback to single-wallet compat
    if (!addr) return '';
    return addr.length <= 12 ? addr : `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  }, [evmAddress, solAddress, address]);

  // ── Value ─────────────────────────────────────────────────────────────────

  const value = useMemo<KiprampWalletState>(() => ({
    status, isConnected, isConnecting,
    evmConnected, evmAddress, evmChainId, evmWalletName, evmWrongNetwork,
    solConnected, solAddress, solWalletName,
    address, ecosystem, network, chainId: evmChainId, walletName, walletType,
    openEvmModal,
    showConnectModal, setShowConnectModal,
    error, setError,
    connectEvm, disconnectEvm, disconnectSol, disconnect, switchToChain, ensureChainForAsset, sendCrypto,
    isCorrectNetworkForAsset, getRequiredNetworkName, getRequiredChainId, shortAddress,
  }), [
    status, isConnected, isConnecting,
    evmConnected, evmAddress, evmChainId, evmWalletName, evmWrongNetwork,
    solConnected, solAddress, solWalletName,
    address, ecosystem, network, walletName, walletType,
    openEvmModal,
    showConnectModal, error,
    connectEvm, disconnectEvm, disconnectSol, disconnect, switchToChain, ensureChainForAsset, sendCrypto,
    isCorrectNetworkForAsset, getRequiredNetworkName, getRequiredChainId, shortAddress,
  ]);

  return <WalletCtx.Provider value={value}>{children}</WalletCtx.Provider>;
}
