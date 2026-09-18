import { TokenSOL, TokenETH, TokenBNB } from '@web3icons/react';

/**
 * TokenIcon — official token marks (web3icons, MIT) for SOL/ETH/BNB.
 * Single choke point: every token glyph in the UI renders through here,
 * so brand-guideline fixes apply in one place. Official colors live ONLY
 * inside these marks — never in UI chrome.
 */
export type TokenSymbol = 'SOL' | 'ETH' | 'BNB';

export function TokenIcon({
  symbol,
  size = 20,
  className,
}: {
  symbol: TokenSymbol | string;
  size?: number | string;
  className?: string;
}) {
  const C = symbol === 'SOL' ? TokenSOL : symbol === 'BNB' ? TokenBNB : TokenETH;
  return <C size={size} variant="branded" className={className} aria-hidden />;
}
