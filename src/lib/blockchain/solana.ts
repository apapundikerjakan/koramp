/**
 * Solana blockchain provider menggunakan @solana/web3.js
 * RPC: SOLANA_RPC_URL dari environment variable (Alchemy)
 * Private key: SOLANA_PLATFORM_PRIVATE_KEY (base58 encoded)
 *
 * PENTING: Gunakan HTTP polling untuk konfirmasi transaksi — JANGAN gunakan
 * sendAndConfirmTransaction() karena itu menggunakan WebSocket signatureSubscribe
 * yang tidak didukung oleh semua RPC provider (termasuk Alchemy HTTP endpoint).
 * Error: { code: -32601, message: "Method 'signatureSubscribe' not found" }
 */
import {
  Connection, PublicKey, Keypair, LAMPORTS_PER_SOL,
  SystemProgram, Transaction,
} from '@solana/web3.js';
import type { BlockchainProvider, TxInfo } from './types';
import { getSolanaRpcUrl } from './network';

// bs58 v5+ exports as ES module default — handle both CJS and ESM interop
const _bs58mod = require('bs58') as {
  decode?: (input: string) => Uint8Array;
  encode?: (input: Uint8Array) => string;
  default?: { decode(input: string): Uint8Array; encode(input: Uint8Array): string };
};
const bs58 = _bs58mod.default ?? (_bs58mod as unknown as {
  decode(input: string): Uint8Array;
  encode(input: Uint8Array): string;
});

function getConnection(): Connection {
  const rpc = getSolanaRpcUrl();
  // Do NOT pass a wsEndpoint — forces HTTP-only mode, avoids signatureSubscribe errors.
  return new Connection(rpc, {
    commitment: 'confirmed',
    disableRetryOnRateLimit: false,
  });
}

function getPlatformKeypair(): Keypair {
  const key = process.env.SOLANA_PLATFORM_PRIVATE_KEY ?? '';
  if (!key) throw new Error('SOLANA_PLATFORM_PRIVATE_KEY not configured');
  return Keypair.fromSecretKey(bs58.decode(key));
}

function isValidSolanaAddress(address: string): boolean {
  try { new PublicKey(address); return true; } catch { return false; }
}

/**
 * Poll konfirmasi transaksi via HTTP getSignatureStatuses — tidak butuh WebSocket.
 * Tidak memblokir response HTTP; dijalankan di background via .then().
 */
async function pollConfirmationHttp(
  conn: Connection,
  signature: string,
  maxAttempts = 60,
  intervalMs = 2000,
): Promise<'confirmed' | 'failed' | 'timeout'> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, intervalMs));
    try {
      const result = await conn.getSignatureStatuses([signature], { searchTransactionHistory: true });
      const status = result.value?.[0];
      if (!status) continue;
      if (status.err) return 'failed';
      const conf = status.confirmationStatus;
      if (conf === 'confirmed' || conf === 'finalized') return 'confirmed';
    } catch {
      // transient RPC error — keep polling
    }
  }
  return 'timeout';
}

export const solanaProvider: BlockchainProvider = {
  network: 'SOLANA',

  isValidAddress: isValidSolanaAddress,

  getDepositAddress(_orderId: string): string {
    try {
      return getPlatformKeypair().publicKey.toBase58();
    } catch (err) {
      console.error('[solana] getDepositAddress failed — check SOLANA_PLATFORM_PRIVATE_KEY:', err);
      return 'SOLANA_PLATFORM_ADDRESS_NOT_CONFIGURED';
    }
  },

  async getBalance(address: string): Promise<string> {
    const conn = getConnection();
    const lamports = await conn.getBalance(new PublicKey(address));
    return (lamports / LAMPORTS_PER_SOL).toString();
  },

  async getTransaction(txHash: string): Promise<TxInfo | null> {
    try {
      const conn = getConnection();
      const tx = await conn.getTransaction(txHash, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      });
      if (!tx) return null;

      const currentSlot = await conn.getSlot('confirmed');
      const confirmations = Math.max(0, currentSlot - tx.slot);
      const failed = !!tx.meta?.err;

      let amount = '0';
      if (tx.meta?.preBalances && tx.meta?.postBalances) {
        amount = (Math.abs(tx.meta.preBalances[0] - tx.meta.postBalances[0]) / LAMPORTS_PER_SOL).toString();
      }

      const keys = tx.transaction.message.getAccountKeys?.()?.staticAccountKeys ?? [];

      return {
        txHash,
        confirmations,
        // devnet: 32 confirmations; production: 32 (finalized)
        isConfirmed: !!tx.meta && !failed && confirmations >= 32,
        amount,
        from: keys[0]?.toBase58() ?? '',
        to: keys[1]?.toBase58() ?? '',
        network: 'SOLANA',
        txStatus: failed ? 'FAILED' : 'SUCCESS',
        pending: false,
        receiptStatus: failed ? 0 : 1,
        blockNumber: null,
        chainId: null,
      };
    } catch {
      return null;
    }
  },

  async getConfirmations(txHash: string): Promise<number> {
    try {
      const conn = getConnection();
      const tx = await conn.getTransaction(txHash, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      });
      if (!tx) return 0;
      const currentSlot = await conn.getSlot('confirmed');
      return Math.max(0, currentSlot - tx.slot);
    } catch {
      return 0;
    }
  },

  async sendTransaction(to: string, amount: string): Promise<{ txHash: string }> {
    const conn = getConnection();
    const keypair = getPlatformKeypair();

    const { default: Decimal } = await import('decimal.js');
    const lamports = new Decimal(amount)
      .mul(LAMPORTS_PER_SOL)
      .toDecimalPlaces(0, Decimal.ROUND_FLOOR)
      .toNumber();

    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');

    const tx = new Transaction({
      recentBlockhash: blockhash,
      feePayer: keypair.publicKey,
    }).add(
      SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: new PublicKey(to),
        lamports,
      }),
    );
    tx.sign(keypair);

    // sendRawTransaction tanpa menunggu konfirmasi via WebSocket.
    // Konfirmasi dilanjutkan oleh check-delivery endpoint (HTTP polling).
    const rawTx = tx.serialize();
    const signature = await conn.sendRawTransaction(rawTx, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
      maxRetries: 3,
    });

    console.info(JSON.stringify({
      scope: 'solana', operation: 'send_transaction',
      signature, to, lamports, lastValidBlockHeight,
    }));

    // Background HTTP polling — tidak blokir HTTP response.
    // check-delivery endpoint akan mengecek status di blockchain secara terpisah.
    pollConfirmationHttp(conn, signature, 60, 2000).then(result => {
      console.info(JSON.stringify({
        scope: 'solana', operation: 'send_transaction_poll_result',
        signature, result,
      }));
    }).catch(() => {});

    return { txHash: signature };
  },
};
