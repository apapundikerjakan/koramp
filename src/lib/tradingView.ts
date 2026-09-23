import type { AssetSymbol } from '@/lib/assets';

/**
 * TradingView symbol map — single source of truth for order-flow charts.
 *
 * The chart is an IDR market reference only. The IDR rate shown in the order
 * summary remains the only pricing source and is never derived from a chart.
 *
 * NOTE on ETH: order flow runs on Base Sepolia (testnet) which has no market
 * price of its own — ETH price always refers to mainnet ETH. Same for BNB
 * (BSC testnet) and SOL (devnet): testnets track mainnet prices.
 */
export const TV_SYMBOLS: Record<AssetSymbol, string> = {
  SOL: 'BINANCE:SOLIDR',
  ETH: 'BINANCE:ETHIDR',
  BNB: 'BINANCE:BNBIDR',
};

export const TV_DISCLAIMER =
  'Grafik TradingView dalam IDR. Rate transaksi mengikuti quote live KORAMP.';

/** localStorage key for the terminal chart open/closed preference (client only). */
export const CHART_OPEN_KEY = 'kipramp_chart_open';

/** Chart symbol before the user picks an asset (no default asset in flow state). */
export const DEFAULT_CHART_ASSET: AssetSymbol = 'ETH';
