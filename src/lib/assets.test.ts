import {
  SUPPORTED_ASSETS,
  SUPPORTED_EVM_CHAIN_IDS,
  EVM_CHAIN_ADD_PARAMS,
  isSupportedEvmChainId,
  RAMP_NETWORK_IDS,
  isRampSupported,
  getRampAssets,
} from '@/lib/assets';

describe('EVM chain auto-detect config', () => {
  it('mendukung Base Sepolia (84532) dan BSC Testnet (97)', () => {
    expect([...SUPPORTED_EVM_CHAIN_IDS]).toEqual(expect.arrayContaining([84532, 97]));
  });

  it('setiap chain yang didukung punya wallet_addEthereumChain params', () => {
    for (const id of SUPPORTED_EVM_CHAIN_IDS) {
      const p = EVM_CHAIN_ADD_PARAMS[id];
      expect(p).toBeDefined();
      expect(p.chainId).toMatch(/^0x[0-9a-fA-F]+$/);
      expect(parseInt(p.chainId, 16)).toBe(id);
      expect(p.rpcUrls.length).toBeGreaterThan(0);
      expect(p.rpcUrls[0]).toMatch(/^https:\/\//);
      expect(p.nativeCurrency.decimals).toBe(18);
      expect(p.blockExplorerUrls.length).toBeGreaterThan(0);
    }
  });

  it('BSC Testnet memakai chainId hex 0x61 dan explorer testnet', () => {
    expect(EVM_CHAIN_ADD_PARAMS[97].chainId).toBe('0x61');
    expect(EVM_CHAIN_ADD_PARAMS[97].blockExplorerUrls[0]).toContain('testnet.bscscan.com');
  });

  it('Base Sepolia memakai chainId hex 0x14A34', () => {
    expect(EVM_CHAIN_ADD_PARAMS[84532].chainId).toBe('0x14A34');
  });

  it('isSupportedEvmChainId menolak mainnet dan nilai kosong', () => {
    expect(isSupportedEvmChainId(97)).toBe(true);
    expect(isSupportedEvmChainId(84532)).toBe(true);
    expect(isSupportedEvmChainId(56)).toBe(false); // BSC mainnet — bukan testnet
    expect(isSupportedEvmChainId(1)).toBe(false);
    expect(isSupportedEvmChainId(null)).toBe(false);
    expect(isSupportedEvmChainId(undefined)).toBe(false);
  });

  it('asset BNB butuh chain 97, ETH butuh 84532', () => {
    expect(SUPPORTED_ASSETS.BNB.chainId).toBe(97);
    expect(SUPPORTED_ASSETS.ETH.chainId).toBe(84532);
    expect(SUPPORTED_ASSETS.BNB.walletEcosystem).toBe('EVM');
  });

  it('Ramp hanya Solana, Base, BNB Chain (Top Up & Sell)', () => {
    expect([...RAMP_NETWORK_IDS].sort()).toEqual(['BASE', 'BSC', 'SOLANA']);
    expect(isRampSupported('SOLANA')).toBe(true);
    expect(isRampSupported('BASE')).toBe(true);
    expect(isRampSupported('BSC')).toBe(true);
    expect(isRampSupported(null)).toBe(false);
    expect(isRampSupported(undefined)).toBe(false);
    expect(getRampAssets().sort()).toEqual(['BNB', 'ETH', 'SOL']);
    for (const a of getRampAssets()) {
      expect(SUPPORTED_ASSETS[a].supportsTopUp).toBe(true);
      expect(SUPPORTED_ASSETS[a].supportsSell).toBe(true);
    }
  });
});
