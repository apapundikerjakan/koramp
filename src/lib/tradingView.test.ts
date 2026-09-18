import { TV_SYMBOLS, TV_DISCLAIMER } from './tradingView';

describe('tradingView symbol map', () => {
  it('covers every supported asset with a USDT reference pair (no xxxIDR)', () => {
    expect(Object.keys(TV_SYMBOLS).sort()).toEqual(['BNB', 'ETH', 'SOL']);
    for (const sym of Object.values(TV_SYMBOLS)) {
      expect(sym).toMatch(/USDT$/);
      expect(sym).not.toMatch(/IDR/);
    }
  });

  it('disclaimer states USDT reference and Kipramp IDR rate authority', () => {
    expect(TV_DISCLAIMER).toMatch(/USDT/);
    expect(TV_DISCLAIMER).toMatch(/IDR/);
  });
});
