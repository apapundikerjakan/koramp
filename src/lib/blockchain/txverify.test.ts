/**
 * Matriks uji TX verification (§29) — murni, tanpa RPC/jaringan.
 * Nilai regresi §28 = kasus NYATA Base Sepolia:
 *   tx 0x49ac043a…6895, from 0xB2Ef…AD4? (lihat bawah), nilai eksak
 *   0.00209256 ETH = 2092560000000000 wei, receipt status 1, chain 84532.
 */
import { toTxInfo, getEvmNetworkConfig } from '@/lib/blockchain/evm';
import {
  weiEquals,
  validateTxForOrder,
  confirmationState,
} from '@/lib/blockchain/scan';
import { getHistorySource } from '@/lib/blockchain/txIndex';

// ─── Kasus nyata §28 ─────────────────────────────────────────────────────────
const SENDER = '0xB2Ef369384C0b582DBd6880226705E8d37988Bdc';
const DEPOSIT = '0x00374758CB227B47d5F21F4b350EE7eFC15d6AD4';
const AMOUNT_ETH = '0.00209256';
const AMOUNT_WEI = '2092560000000000';
const BLOCK = 46866747;

describe('toTxInfo (§5/§6: PENDING/SUCCESS/FAILED)', () => {
  const base = {
    txHash: '0x49ac',
    tx: { value: BigInt(AMOUNT_WEI), from: SENDER, to: DEPOSIT },
    currentBlock: BLOCK + 5,
    chainId: 84532,
    network: 'BASE',
    requiredConfirmations: 3,
  };

  it('2. successful transaction (receipt 1, conf math)', () => {
    const info = toTxInfo({ ...base, receipt: { status: 1, blockNumber: BLOCK } });
    expect(info).not.toBeNull();
    expect(info!.txStatus).toBe('SUCCESS');
    expect(info!.pending).toBe(false);
    expect(info!.receiptStatus).toBe(1);
    expect(info!.confirmations).toBe(5);
    expect(info!.isConfirmed).toBe(true);
    expect(info!.amount).toBe(AMOUNT_ETH);
  });

  it('10/11. partial confirmations → belum confirmed', () => {
    const info = toTxInfo({
      ...base, receipt: { status: 1, blockNumber: BLOCK + 4 },
      currentBlock: BLOCK + 5,
    });
    expect(info!.confirmations).toBe(1);
    expect(info!.isConfirmed).toBe(false);
    expect(info!.txStatus).toBe('SUCCESS'); // mined sukses, tinggal tunggu
  });

  it('1. pending transaction (belum ada receipt)', () => {
    const info = toTxInfo({ ...base, receipt: null });
    expect(info!.txStatus).toBe('PENDING');
    expect(info!.pending).toBe(true);
    expect(info!.receiptStatus).toBeNull();
    expect(info!.confirmations).toBe(0);
    expect(info!.isConfirmed).toBe(false);
  });

  it('3. failed transaction (receipt 0) — tidak pernah confirmed', () => {
    const info = toTxInfo({ ...base, receipt: { status: 0, blockNumber: BLOCK } });
    expect(info!.txStatus).toBe('FAILED');
    expect(info!.receiptStatus).toBe(0);
    expect(info!.isConfirmed).toBe(false);
  });

  it('tx tidak ada → null (NOT_FOUND)', () => {
    expect(toTxInfo({ ...base, tx: null, receipt: null })).toBeNull();
  });
});

describe('weiEquals (§7: exact, bukan blanket 0.0001)', () => {
  it('nilai eksak §28 cocok', async () => {
    await expect(weiEquals(AMOUNT_ETH, AMOUNT_ETH)).resolves.toBe(true);
  });

  it('6. selisih 1 wei DITOLAK secara default', async () => {
    await expect(weiEquals('0.002092560000000001', AMOUNT_ETH)).resolves.toBe(false);
  });

  it('toleransi eksplisit dalam wei bila bisnis butuh', async () => {
    await expect(weiEquals('0.002092560000000001', AMOUNT_ETH, '1')).resolves.toBe(true);
  });

  it('6. nominal salah ditolak', async () => {
    await expect(weiEquals('0.00209000', AMOUNT_ETH)).resolves.toBe(false);
  });

  it('input rusak → false', async () => {
    await expect(weiEquals('bukan-angka', AMOUNT_ETH)).resolves.toBe(false);
    await expect(weiEquals(AMOUNT_ETH, '0.0000000000000000001x')).resolves.toBe(false);
  });
});

describe('validateTxForOrder (§21: satu pintu, 10 cek)', () => {
  const goodTx = toTxInfo({
    txHash: '0x49ac',
    tx: { value: BigInt(AMOUNT_WEI), from: SENDER, to: DEPOSIT },
    receipt: { status: 1, blockNumber: BLOCK },
    currentBlock: BLOCK + 900,
    chainId: 84532,
    network: 'BASE',
    requiredConfirmations: 3,
  })!;
  const order = { depositAddress: DEPOSIT, walletAddress: SENDER, expectedAmountEth: AMOUNT_ETH };

  it('28. REGRESI: kasus nyata §28 lolos TANPA block scan', async () => {
    await expect(validateTxForOrder(goodTx, order)).resolves.toEqual({ ok: true });
  });

  it('4. wrong sender ditolak', async () => {
    const r = await validateTxForOrder(
      { ...goodTx, from: '0x0000000000000000000000000000000000000001' }, order,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('sender_mismatch');
  });

  it('5. wrong recipient ditolak', async () => {
    const r = await validateTxForOrder(
      { ...goodTx, to: '0x0000000000000000000000000000000000000002' }, order,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('wrong_recipient');
  });

  it('6. wrong amount ditolak', async () => {
    const r = await validateTxForOrder({ ...goodTx, amount: '0.00209000' }, order);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('amount_mismatch');
  });

  it('8. failed tx DITOLAK — tidak pernah DETECTED', async () => {
    const failed = toTxInfo({
      txHash: '0x49ac',
      tx: { value: BigInt(AMOUNT_WEI), from: SENDER, to: DEPOSIT },
      receipt: { status: 0, blockNumber: BLOCK },
      currentBlock: BLOCK + 5, chainId: 84532, network: 'BASE', requiredConfirmations: 3,
    })!;
    const r = await validateTxForOrder(failed, order);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('tx_failed');
  });

  it('null → tx_not_found', async () => {
    const r = await validateTxForOrder(null, order);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('tx_not_found');
  });

  it('7. duplicate reconocimiento: hash SAMA untuk order BEDA dianggap reuse di level route (DB) — validator murni tidak menolak klaim sah', async () => {
    // Validator tidak tahu order lain (cek reuse ada di route via DB).
    // Pastikan klaim sah tidak pernah ditolak validator.
    await expect(validateTxForOrder(goodTx, order)).resolves.toEqual({ ok: true });
  });
});

describe('confirmationState (§15)', () => {
  it('0 → DETECTED, 1-2/3 → CONFIRMING, 3/3+ → CONFIRMED', () => {
    expect(confirmationState(0, 3)).toBe('DETECTED');
    expect(confirmationState(1, 3)).toBe('CONFIRMING');
    expect(confirmationState(2, 3)).toBe('CONFIRMING');
    expect(confirmationState(3, 3)).toBe('CONFIRMED');
    expect(confirmationState(869, 3)).toBe('CONFIRMED');
  });
});

describe('chain config eksplisit (§9)', () => {
  it('BASE=84532, BSC=97 (testnet default)', () => {
    expect(getEvmNetworkConfig('BASE').chainId).toBe(84532);
    expect(getEvmNetworkConfig('BSC').chainId).toBe(97);
  });

  it('9. network tak dikenal & env rusak ditolak', () => {
    expect(() => getEvmNetworkConfig('NOPE' as never)).toThrow();
    const prev = process.env.BASE_CHAIN_ID;
    process.env.BASE_CHAIN_ID = 'bukan-angka';
    expect(() => getEvmNetworkConfig('BASE')).toThrow();
    if (prev === undefined) delete process.env.BASE_CHAIN_ID;
    else process.env.BASE_CHAIN_ID = prev;
  });

  it('override env dihormati (mainnet)', () => {
    const prev = process.env.BSC_CHAIN_ID;
    process.env.BSC_CHAIN_ID = '56';
    expect(getEvmNetworkConfig('BSC').chainId).toBe(56);
    if (prev === undefined) delete process.env.BSC_CHAIN_ID;
    else process.env.BSC_CHAIN_ID = prev;
  });
});

describe('history source per network (§11/§12)', () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of ['BASE_HISTORY_PROVIDER', 'BSC_HISTORY_PROVIDER']) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('default = block-scan (bounded)', () => {
    delete process.env.BASE_HISTORY_PROVIDER;
    delete process.env.BSC_HISTORY_PROVIDER;
    expect(getHistorySource('BASE').name).toBe('block-scan-fallback');
    expect(getHistorySource('BSC').name).toBe('block-scan-fallback');
  });

  it('blockscout untuk BASE; BSC tanpa indexer terbuka → fallback', () => {
    process.env.BASE_HISTORY_PROVIDER = 'blockscout';
    process.env.BSC_HISTORY_PROVIDER = 'blockscout';
    expect(getHistorySource('BASE').name).toBe('blockscout-txlist');
    expect(getHistorySource('BSC').name).toBe('block-scan-fallback');
  });

  it('18. alchemy tanpa konfigurasi → fallback (tidak mungkin merusak BSC)', () => {
    delete process.env.ALCHEMY_API_KEY;
    process.env.BASE_HISTORY_PROVIDER = 'alchemy';
    expect(getHistorySource('BASE').name).toBe('block-scan-fallback');
  });

  it('nilai tak dikenal → fallback aman', () => {
    process.env.BASE_HISTORY_PROVIDER = 'ngawur';
    expect(getHistorySource('BASE').name).toBe('block-scan-fallback');
  });
});
