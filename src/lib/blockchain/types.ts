export type EvmTxStatus = 'NOT_FOUND' | 'PENDING' | 'SUCCESS' | 'FAILED';

export interface TxInfo {
  txHash: string;
  confirmations: number;
  isConfirmed: boolean;
  amount: string;
  from: string;
  to: string;
  network: string;
  // ── Extended inspection (§5/§6) — selalu diisi provider EVM ──────────────
  /** Delivery state: NOT_FOUND hanya diwakili return null (kontrak lama). */
  txStatus?: EvmTxStatus;
  /** true bila tx ada tapi belum punya receipt (mempool). */
  pending?: boolean;
  /** Receipt status: 1 sukses, 0 gagal, null bila belum mined. */
  receiptStatus?: 0 | 1 | null;
  /** Block tx; null bila pending. */
  blockNumber?: number | null;
  /** Chain ID endpoint yang ditanya (sudah terverifikasi). */
  chainId?: number | null;
}

export interface BlockchainProvider {
  network: string;
  getBalance(address: string): Promise<string>;
  getTransaction(txHash: string): Promise<TxInfo | null>;
  getConfirmations(txHash: string): Promise<number>;
  sendTransaction(to: string, amount: string): Promise<{ txHash: string }>;
  isValidAddress(address: string): boolean;
  getDepositAddress(orderId: string): string;
  estimateFeeLamports?(): Promise<string>;
}
