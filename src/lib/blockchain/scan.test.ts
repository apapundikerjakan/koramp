import { sameAddress, amountMatches } from '@/lib/blockchain/scan';

describe('scan matching helpers (dipakai deteksi deposit EVM/Solana)', () => {
  describe('sameAddress', () => {
    it('EVM case-insensitive (checksum vs lowercase)', () => {
      expect(sameAddress(
        '0x00374758CB227B47d5F21F4b350EE7eFC15d6AD4',
        '0x00374758cb227b47d5f21f4b350ee7efc15d6ad4',
      )).toBe(true);
    });
    it('EVM beda address ditolak', () => {
      expect(sameAddress(
        '0x00374758CB227B47d5F21F4b350EE7eFC15d6AD4',
        '0x0000000000000000000000000000000000000001',
      )).toBe(false);
    });
    it('Solana base58 exact (case-sensitive)', () => {
      expect(sameAddress('4uQeVj5tqViQh7y8eksr6Spz9fTc1mKt2oLZa9sDf', '4uQeVj5tqViQh7y8eksr6Spz9fTc1mKt2oLZa9sDf')).toBe(true);
      expect(sameAddress('ABC', 'abc')).toBe(false);
    });
  });

  describe('amountMatches', () => {
    it('nilai eksak cocok', () => {
      expect(amountMatches('0.05', '0.05', '0.0001')).toBe(true);
    });
    it('selisih dalam toleransi cocok (dust/rounding)', () => {
      expect(amountMatches('0.050000001', '0.05', '0.0001')).toBe(true);
      expect(amountMatches('0.04995', '0.05', '0.0001')).toBe(true);
    });
    it('selisih di luar toleransi ditolak', () => {
      expect(amountMatches('0.051', '0.05', '0.0001')).toBe(false);
      expect(amountMatches('999999.0', '0.05', '0.0001')).toBe(false);
    });
    it('angka presisi tinggi tetap Decimal-aman', () => {
      expect(amountMatches('0.123456789012345678', '0.12345679', '0.0001')).toBe(true);
    });
    it('input rusak → false, bukan throw', () => {
      expect(amountMatches('bukan-angka', '0.05', '0.0001')).toBe(false);
    });
  });
});
