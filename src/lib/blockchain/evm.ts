/**
 * EVM blockchain provider (Base + BSC) using ethers v6
 *
 * RPC diambil via network.ts agar konsisten dengan konfigurasi frontend
 * dan fail-fast di production saat env var tidak di-set.
 *
 * Chain identity TIDAK ditebak dari string URL (§9) — tiap network punya
 * chain ID eksplisit (BASE_CHAIN_ID / BSC_CHAIN_ID, default testnet) yang
 * diverifikasi via eth_chainId. Mismatch = fail closed.
 */
import { ethers } from 'ethers';
import { BlockchainProvider, TxInfo, EvmTxStatus } from './types';
import { getBaseRpcUrl, getBscRpcUrl } from './network';

// ─── Explicit network config (§9/§26) ────────────────────────────────────────
// Satu-satunya tempat definisi chain identity. Tidak ada .includes('bsc').

export interface EvmNetworkConfig {
  name: string;
  chainId: number;
  rpcEnvKey: 'BASE_RPC_URL' | 'BSC_RPC_URL';
  privateKeyEnvKey: 'BASE_PLATFORM_PRIVATE_KEY' | 'BSC_PLATFORM_PRIVATE_KEY';
}

function chainIdFromEnv(envKey: string, fallback: number): number {
  const raw = process.env[envKey]?.trim();
  if (!raw) return fallback;
  const v = Number(raw);
  if (!Number.isInteger(v) || v <= 0) {
    throw new Error(`[evm] Invalid ${envKey} "${raw}" — expected integer chain ID`);
  }
  return v;
}

export function getEvmNetworkConfig(networkName: string): EvmNetworkConfig {
  if (networkName === 'BASE') {
    return {
      name: 'BASE',
      // Default testnet (84532). Mainnet: set BASE_CHAIN_ID=8453 + RPC mainnet.
      chainId: chainIdFromEnv('BASE_CHAIN_ID', 84532),
      rpcEnvKey: 'BASE_RPC_URL',
      privateKeyEnvKey: 'BASE_PLATFORM_PRIVATE_KEY',
    };
  }
  if (networkName === 'BSC') {
    return {
      name: 'BSC',
      // Default testnet (97). Mainnet: set BSC_CHAIN_ID=56 + RPC mainnet.
      chainId: chainIdFromEnv('BSC_CHAIN_ID', 97),
      rpcEnvKey: 'BSC_RPC_URL',
      privateKeyEnvKey: 'BSC_PLATFORM_PRIVATE_KEY',
    };
  }
  throw new Error(`[evm] Unknown EVM network: ${networkName}`);
}

function getProvider(rpcUrl: string, chainId: number) {
  // staticNetwork prevents ethers from auto-detecting the network on init
  // (which would spam "JsonRpcProvider failed to detect network" retries).
  // Chain ID diberikan eksplisit — bukan ditebak dari URL.
  return new ethers.JsonRpcProvider(rpcUrl, chainId, {
    staticNetwork: true,
    polling: false,
  });
}

/**
 * Fail-closed chain verification (§9): pastikan endpoint RPC benar-benar
 * melayani chain yang dikonfigurasi. Dipanggil sebelum inspeksi tracking.
 */
export async function verifyNetworkChain(networkName: string): Promise<{ ok: boolean; expected: number; actual: number | null }> {
  const cfg = getEvmNetworkConfig(networkName);
  const provider = getProvider(getRpc(cfg.rpcEnvKey), cfg.chainId);
  const actual = await provider.send('eth_chainId', [])
    .then((hex: string) => Number(hex))
    .catch(() => null);
  return { ok: actual === cfg.chainId, expected: cfg.chainId, actual };
}

async function getVerifiedProvider(networkName: string): Promise<ethers.JsonRpcProvider> {
  const cfg = getEvmNetworkConfig(networkName);
  const provider = getProvider(getRpc(cfg.rpcEnvKey), cfg.chainId);
  const actual = await provider.send('eth_chainId', [])
    .then((hex: string) => Number(hex))
    .catch(() => null);
  if (actual !== cfg.chainId) {
    throw new Error(
      `[evm:${networkName}] RPC chain mismatch: endpoint serves ${actual}, expected ${cfg.chainId}. Refusing (fail closed).`,
    );
  }
  return provider;
}

function getWallet(privateKey: string, rpcUrl: string, chainId: number) {
  const provider = getProvider(rpcUrl, chainId);
  // ethers v6 expects 0x-prefixed hex key
  const key = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
  return new ethers.Wallet(key, provider);
}

function isValidEvmAddress(address: string): boolean {
  return ethers.isAddress(address);
}

/**
 * Pure mapper: raw RPC result → TxInfo dengan status eksplisit (§5/§6).
 * Dipisah murni agar bisa di-unit-test tanpa RPC (kasus PENDING/SUCCESS/FAILED).
 * NOT_FOUND diwakili return null (kontrak caller lama).
 */
export function toTxInfo(args: {
  txHash: string;
  tx: { value: bigint; from?: string; to?: string | null } | null;
  receipt: { status?: number | null; blockNumber?: number | null } | null;
  currentBlock: number;
  chainId: number;
  network: string;
  requiredConfirmations: number;
}): TxInfo | null {
  const { txHash, tx, receipt, currentBlock, chainId, network, requiredConfirmations } = args;
  if (!tx) return null;
  const base = {
    txHash,
    from: tx.from ?? '',
    to: tx.to ?? '',
    amount: ethers.formatEther(tx.value),
    network,
    chainId,
  };
  if (!receipt) {
    return {
      ...base,
      confirmations: 0,
      isConfirmed: false,
      txStatus: 'PENDING' as EvmTxStatus,
      pending: true,
      receiptStatus: null,
      blockNumber: null,
    };
  }
  if (receipt.status === 0) {
    return {
      ...base,
      confirmations: receipt.blockNumber != null ? Math.max(0, currentBlock - receipt.blockNumber) : 0,
      isConfirmed: false,
      txStatus: 'FAILED' as EvmTxStatus,
      pending: false,
      receiptStatus: 0 as const,
      blockNumber: receipt.blockNumber ?? null,
    };
  }
  const confirmations = receipt.blockNumber != null ? Math.max(0, currentBlock - receipt.blockNumber) : 0;
  return {
    ...base,
    confirmations,
    isConfirmed: confirmations >= requiredConfirmations,
    txStatus: 'SUCCESS' as EvmTxStatus,
    pending: false,
    receiptStatus: 1 as const,
    blockNumber: receipt.blockNumber ?? null,
  };
}

function requiredConfs(networkName: string): number {
  // Testnet: 3 confirmations; Production: Base=12, BSC=15
  return process.env.NODE_ENV === 'production'
    ? (networkName === 'BASE' ? 12 : 15)
    : 3;
}

const RPC_GETTERS: Record<string, () => string> = {
  BASE_RPC_URL: getBaseRpcUrl,
  BSC_RPC_URL: getBscRpcUrl,
};

function getRpc(_envKey: string): string {
  // Env key dipertahankan sebagai parameter agar pemanggilan tetap eksplisit,
  // tapi nilai diambil dari network.ts yang fail-fast di production.
  return RPC_GETTERS[_envKey]();
}

function createEvmProvider(networkName: string, rpcEnvKey: string, privateKeyEnvKey: string): BlockchainProvider {
  return {
    network: networkName,

    isValidAddress: isValidEvmAddress,

    getDepositAddress(_orderId: string): string {
      const key = process.env[privateKeyEnvKey] ?? '';
      if (!key) return 'EVM_PLATFORM_ADDRESS_NOT_CONFIGURED';
      try {
        const k = key.startsWith('0x') ? key : `0x${key}`;
        return new ethers.Wallet(k).address;
      } catch {
        return 'INVALID_KEY';
      }
    },

    async getBalance(address: string): Promise<string> {
      const cfg = getEvmNetworkConfig(networkName);
      const provider = getProvider(getRpc(rpcEnvKey), cfg.chainId);
      const bal = await provider.getBalance(address);
      return ethers.formatEther(bal);
    },

    async getTransaction(txHash: string): Promise<TxInfo | null> {
      // Chain TERVERIFIKASI dulu (fail closed §9), lalu inspeksi (§6):
      // eth_getTransactionByHash + eth_getTransactionReceipt + eth_blockNumber.
      const cfg = getEvmNetworkConfig(networkName);
      const provider = await getVerifiedProvider(networkName);
      try {
        const [tx, receipt, currentBlock] = await Promise.all([
          provider.getTransaction(txHash),
          provider.getTransactionReceipt(txHash),
          provider.getBlockNumber(),
        ]);
        // "Terdeteksi" HANYA bila objek tx ada — dan status ditentukan
        // dari receipt (PENDING/SUCCESS/FAILED), bukan dari keberadaan tx.
        return toTxInfo({
          txHash,
          tx: tx ? { value: tx.value, from: tx.from ?? undefined, to: tx.to ?? undefined } : null,
          receipt: receipt ? { status: receipt.status ?? null, blockNumber: receipt.blockNumber ?? null } : null,
          currentBlock,
          chainId: cfg.chainId,
          network: networkName,
          requiredConfirmations: requiredConfs(networkName),
        });
      } catch (err) {
        console.warn(`[evm:${networkName}] getTransaction(${txHash}) failed:`, err);
        return null;
      }
    },

    async getConfirmations(txHash: string): Promise<number> {
      const provider = await getVerifiedProvider(networkName).catch(() => null);
      if (!provider) return 0;
      try {
        const [receipt, currentBlock] = await Promise.all([
          provider.getTransactionReceipt(txHash),
          provider.getBlockNumber(),
        ]);
        return receipt?.blockNumber ? currentBlock - receipt.blockNumber : 0;
      } catch (err) {
        console.warn(`[evm:${networkName}] getConfirmations(${txHash}) failed:`, err);
        return 0;
      }
    },

    async sendTransaction(to: string, amount: string): Promise<{ txHash: string }> {
      const key = process.env[privateKeyEnvKey] ?? '';
      const cfg = getEvmNetworkConfig(networkName);
      const wallet = getWallet(key, getRpc(rpcEnvKey), cfg.chainId);
      const tx = await wallet.sendTransaction({ to, value: ethers.parseEther(amount) });
      return { txHash: tx.hash };
    },
  };
}

export const baseProvider = createEvmProvider('BASE', 'BASE_RPC_URL', 'BASE_PLATFORM_PRIVATE_KEY');
export const bscProvider = createEvmProvider('BSC', 'BSC_RPC_URL', 'BSC_PLATFORM_PRIVATE_KEY');
