/**
 * Kipramp — Centralized asset + network configuration.
 * Single source of truth for frontend and backend validation.
 * Never define asset/network mappings in individual pages.
 */

export type AssetSymbol = 'SOL' | 'ETH' | 'BNB';
export type NetworkId = 'SOLANA' | 'BASE' | 'BSC';
export type WalletEcosystem = 'EVM' | 'SOLANA';

export interface AssetConfig {
  symbol: AssetSymbol;
  name: string;
  // NOTE: token marks render via <TokenIcon> (official SVGs) — no glyph strings here.
  networkName: string;
  networkId: NetworkId;
  chainId: number | null;
  walletEcosystem: WalletEcosystem;
  color: string;
  border: string;
  bg: string;
  decimals: number;
  explorerBaseUrl: string;
}

export const SUPPORTED_ASSETS: Record<AssetSymbol, AssetConfig> = {
  SOL: {
    symbol: 'SOL',
    name: 'Solana',
    networkName: 'Solana Devnet',
    networkId: 'SOLANA',
    chainId: null,
    walletEcosystem: 'SOLANA',
    color: 'text-purple-400',
    border: 'border-purple-500/30',
    bg: 'bg-purple-500/10',
    decimals: 9,
    explorerBaseUrl: 'https://solscan.io/tx/?cluster=devnet&tx=',
  },
  ETH: {
    symbol: 'ETH',
    name: 'Ethereum (Base Sepolia)',
    networkName: 'Base Sepolia (Testnet)',
    networkId: 'BASE',
    chainId: 84532,           // Base Sepolia
    walletEcosystem: 'EVM',
    color: 'text-blue-400',
    border: 'border-blue-500/30',
    bg: 'bg-blue-500/10',
    decimals: 18,
    explorerBaseUrl: 'https://sepolia.basescan.org/tx/',
  },
  BNB: {
    symbol: 'BNB',
    name: 'BNB (BSC Testnet)',
    networkName: 'BSC Testnet',
    networkId: 'BSC',
    chainId: 97,              // BSC Testnet
    walletEcosystem: 'EVM',
    color: 'text-yellow-400',
    border: 'border-yellow-500/30',
    bg: 'bg-yellow-500/10',
    decimals: 18,
    explorerBaseUrl: 'https://testnet.bscscan.com/tx/',
  },
};

export const ASSET_LIST = Object.values(SUPPORTED_ASSETS);

export const CHAIN_ID_TO_ASSET: Record<number, AssetConfig> = {
  84532: SUPPORTED_ASSETS.ETH,  // Base Sepolia
  97: SUPPORTED_ASSETS.BNB,     // BSC Testnet
};

export const SUPPORTED_EVM_CHAIN_IDS = [84532, 97] as const;

export function isSupportedEvmChainId(
  chainId: number | null | undefined,
): chainId is (typeof SUPPORTED_EVM_CHAIN_IDS)[number] {
  return chainId != null && (SUPPORTED_EVM_CHAIN_IDS as readonly number[]).includes(chainId);
}

// ─── wallet_addEthereumChain params (auto-add fallback) ───────────────────────
// Dipakai saat wallet user belum punya chain testnet (error 4902):
// switch gagal → add chain → retry switch. Single source of truth,
// jangan definisikan ulang di page/modal mana pun.

export interface EvmChainAddParam {
  chainId: string; // hex, e.g. '0x61'
  chainName: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrls: string[];
  blockExplorerUrls: string[];
}

function resolvePublicRpc(envVal: string | undefined, fallback: string): string {
  const trimmed = envVal?.trim();
  return trimmed || fallback;
}

export const EVM_CHAIN_ADD_PARAMS: Record<number, EvmChainAddParam> = {
  97: {
    chainId: '0x61',
    chainName: 'BNB Smart Chain Testnet',
    nativeCurrency: { name: 'BNB', symbol: 'tBNB', decimals: 18 },
    rpcUrls: [
      resolvePublicRpc(
        typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_BSC_RPC_URL : undefined,
        'https://data-seed-prebsc-1-s1.binance.org:8545',
      ),
    ],
    blockExplorerUrls: ['https://testnet.bscscan.com'],
  },
  84532: {
    chainId: '0x14A34',
    chainName: 'Base Sepolia',
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: [
      resolvePublicRpc(
        typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_BASE_RPC_URL : undefined,
        'https://sepolia.base.org',
      ),
    ],
    blockExplorerUrls: ['https://sepolia.basescan.org'],
  },
};

export const CHAIN_NAMES: Record<number, string> = {
  84532: 'Base Sepolia',
  97: 'BSC Testnet',
  8453: 'Base',
  56: 'BNB Smart Chain',
  1: 'Ethereum Mainnet',
  11155111: 'Sepolia',
};

export function getAssetByNetwork(networkId: NetworkId): AssetConfig | undefined {
  return ASSET_LIST.find(a => a.networkId === networkId);
}

export function validateAssetNetwork(asset: AssetSymbol, network: NetworkId): boolean {
  return SUPPORTED_ASSETS[asset]?.networkId === network;
}

export function getWalletEcosystem(asset: AssetSymbol): WalletEcosystem {
  return SUPPORTED_ASSETS[asset].walletEcosystem;
}

export function validateWalletTypeForAsset(walletType: 'EVM' | 'SOLANA', asset: AssetSymbol): boolean {
  return walletType === SUPPORTED_ASSETS[asset].walletEcosystem;
}

export function getTxExplorerUrl(networkId: NetworkId, txHash: string): string {
  const asset = getAssetByNetwork(networkId);
  return asset ? `${asset.explorerBaseUrl}${txHash}` : '#';
}
