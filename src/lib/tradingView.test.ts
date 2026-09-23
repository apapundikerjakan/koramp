import { TV_SYMBOLS, TV_DISCLAIMER, CHART_OPEN_KEY, DEFAULT_CHART_ASSET } from './tradingView';

describe('tradingView symbol map', () => {
  it('covers every supported asset with an IDR reference pair', () => {
    expect(Object.keys(TV_SYMBOLS).sort()).toEqual(['BNB', 'ETH', 'SOL']);
    for (const sym of Object.values(TV_SYMBOLS)) {
      expect(sym).toMatch(/^BINANCE:(SOL|ETH|BNB)IDR$/);
      expect(sym).toMatch(/IDR$/);
      expect(sym).not.toMatch(/USDT/);
    }
  });

  it('states the IDR chart and Koramp quote authority', () => {
    expect(TV_DISCLAIMER).toMatch(/IDR/);
    expect(TV_DISCLAIMER).toMatch(/quote live Koramp/i);
    expect(TV_DISCLAIMER).not.toMatch(/USDT/i);
  });

  it('exposes a namespaced localStorage key and a valid default asset', () => {
    expect(CHART_OPEN_KEY).toMatch(/^kipramp_/);
    expect(TV_SYMBOLS[DEFAULT_CHART_ASSET]).toMatch(/IDR$/);
  });

  it('cannot regress to legacy USDT chart mappings', () => {
    const mappings = Object.values(TV_SYMBOLS).join('|');
    expect(mappings).not.toContain('SOLUSDT');
    expect(mappings).not.toContain('ETHUSDT');
    expect(mappings).not.toContain('BNBUSDT');
  });
});