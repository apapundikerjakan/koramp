import type { AssetSymbol } from '@/lib/assets';

/**
 * TradingView symbol map — single source of truth for order-flow charts.
 *
 * TradingView has no xxxIDR pairs for SOL/ETH/BNB, so charts reference the
 * global USDT pairs. The IDR rate shown in SummaryPanel stays the ONLY
 * pricing source (never recomputed from the chart).
 *
 * NOTE on ETH: order flow runs on Base Sepolia (testnet) which has no market
 * price of its own — ETH price always refers to mainnet ETH. Same for BNB
 * (BSC testnet) and SOL (devnet): testnets track mainnet prices.
 */
export const TV_SYMBOLS: Record<AssetSymbol, string> = {
  SOL: 'BINANCE:SOLUSDT',
  ETH: 'BINANCE:ETHUSDT',
  BNB: 'BINANCE:BNBUSDT',
};

export const TV_DISCLAIMER =
  'Grafik harga referensi global (USDT). Kurs IDR mengikuti rate live Kipramp di atas.';
