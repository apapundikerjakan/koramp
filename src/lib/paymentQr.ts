/**
 * Payment QR URI generators
 *
 * Solana Pay:  solana:<address>?amount=<SOL>&label=<label>&message=<msg>&memo=<orderNumber>
 * EVM (EIP-681): ethereum:<address>?value=<wei>  (works for Base/BSC native transfers)
 *
 * These URIs can be encoded into a QR code that wallet apps scan directly.
 * The user scans → wallet pre-fills destination + amount → one-tap approve.
 */

import Decimal from 'decimal.js';

export interface PaymentQrOpts {
  depositAddress: string;
  amount: string;        // human-readable e.g. "0.1" (SOL) or "0.001" (ETH)
  asset: 'SOL' | 'ETH' | 'BNB';
  orderNumber: string;   // shown in wallet as memo/label
  label?: string;        // shown in wallet app
}

/**
 * Build a payment URI for QR encoding.
 * Returns the URI string suitable for `qrcode` or similar libraries.
 * Sync + light (Decimal only, no ethers in client bundle) + exact (no float).
 */
export function buildPaymentUri(opts: PaymentQrOpts): string {
  const { depositAddress, amount, asset, orderNumber, label = 'KORAMP' } = opts;

  if (asset === 'SOL') {
    // Solana Pay spec: https://docs.solanapay.com/spec
    const params = new URLSearchParams({
      amount,
      label,
      message: `Sell ${asset} - ${orderNumber}`,
      memo: orderNumber,
    });
    return `solana:${depositAddress}?${params.toString()}`;
  }

  // EVM EIP-681 — native coin transfer (ETH on Base, BNB on BSC)
  // value must be in wei (18 decimals). Exact Decimal shift, never parseFloat.
  const wei = new Decimal(amount)
    .mul(new Decimal('1000000000000000000'))
    .toDecimalPlaces(0, Decimal.ROUND_FLOOR)
    .toFixed(0);
  return `ethereum:${depositAddress}?value=${wei}`;
}

/**
 * Build a deep-link URI that opens the specific wallet app.
 * Falls back to generic payment URI if wallet is not in the known list.
 */
export function buildWalletDeepLink(opts: PaymentQrOpts & { walletName?: string }): string {
  const uri = buildPaymentUri(opts);

  if (opts.asset === 'SOL') {
    const walletLower = (opts.walletName ?? '').toLowerCase();
    if (walletLower.includes('phantom')) {
      return `https://phantom.app/ul/send?to=${opts.depositAddress}&amount=${opts.amount}&splToken=&network=mainnet`;
    }
    if (walletLower.includes('solflare')) {
      return `https://solflare.com/ul/send?to=${opts.depositAddress}&amount=${opts.amount}`;
    }
    // Generic Solana Pay deeplink (most wallets support)
    return `https://phantom.app/ul/v1/transfer?url=${encodeURIComponent(uri)}`;
  }

  // EVM — MetaMask mobile deep link
  return `https://metamask.app.link/send/${uri}`;
}
