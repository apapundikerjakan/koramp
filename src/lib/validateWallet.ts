import { ValidationError } from './errors';
import { getWalletEcosystem, validateAssetNetwork, type AssetSymbol, type NetworkId } from './assets';
import { getBlockchainProvider } from './blockchain';

/**
 * Shared wallet triplet validation — previously copy-pasted in
 * orders/topup, orders/sell, wallets/validate, wallets/signature + lib/orders.
 */
export function assertWalletForOrder(opts: {
  asset: AssetSymbol;
  network: NetworkId;
  walletType: 'EVM' | 'SOLANA';
  walletAddress: string;
}): void {
  const { asset, network, walletType, walletAddress } = opts;
  if (!validateAssetNetwork(asset, network)) {
    throw new ValidationError(`Asset ${asset} tidak cocok dengan network ${network}`);
  }
  if (walletType !== getWalletEcosystem(asset)) {
    throw new ValidationError(`Wallet type ${walletType} tidak cocok untuk asset ${asset}`);
  }
  const bc = getBlockchainProvider(network);
  if (!bc.isValidAddress(walletAddress)) {
    throw new ValidationError(`Alamat wallet tidak valid untuk network ${network}`);
  }
}

/** Canonical required-confirmations — single definition for all callers. */
export function getRequiredConfirmations(
  network: NetworkId,
  asset?: string,
  override?: number | null,
): number {
  if (typeof override === 'number' && Number.isFinite(override) && override > 0) return override;
  if (network === 'SOLANA') {
    return process.env.NODE_ENV === 'production' ? 32 : asset === 'SOL' ? 32 : 5;
  }
  if (process.env.NODE_ENV !== 'production') return 3;
  return network === 'BASE' ? 12 : 15;
}
