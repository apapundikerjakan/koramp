/**
 * EVM transaction history abstraction (P11).
 *
 * Problem: scanning ~200 full blocks per browser poll is expensive and
 * unbounded. This module provides a clean seam so production can plug a
 * real indexer (Alchemy alchemy_getAssetTransfers, Etherscan, etc.)
 * without changing callers.
 *
 * Default: limited block-scan fallback with strict caps (used in dev/test).
 * If ALCHEMY/ETHERSCAN keys are configured, IndexedHistorySource is used.
 */
import type { NetworkId } from './index';

export interface TransferCandidate {
  hash: string;
  from: string;
  to: string;
  valueEth: string; // decimal string (ether units)
  blockNumber: number;
}

export interface HistorySource {
  name: string;
  getRecentTransfers(
    network: NetworkId,
    address: string,
    opts: { maxBlocks: number; timeoutMs?: number },
  ): Promise<TransferCandidate[]>;
}

/** Limited block-scan fallback — capped, never unbounded. */
export class BlockScanHistorySource implements HistorySource {
  name = 'block-scan-fallback';
  async getRecentTransfers(
    network: NetworkId,
    address: string,
    opts: { maxBlocks: number; timeoutMs?: number },
  ): Promise<TransferCandidate[]> {
    const { ethers } = await import('ethers');
    const { getBaseRpcUrl, getBscRpcUrl } = await import('./network');
    const rpc = network === 'BASE' ? getBaseRpcUrl() : getBscRpcUrl();
    const provider = new ethers.JsonRpcProvider(rpc);
    // Bounded window (P11). 200 blok ≈ 10 mnt BSC testnet / ~7 mnt Base Sepolia —
    // cukup untuk menutup jeda polling, tetap terbatas agar tidak membebani RPC.
    const maxBlocks = Math.min(opts.maxBlocks, 200);
    // timeoutMs SEBELUMNYA DIABAIKAN → scan 50 blok sekuensial bisa gantung
    // 8–30 dtk dan memicu rate-limit RPC. Sekarang: batch paralel + deadline.
    const deadline = Date.now() + (opts.timeoutMs ?? 15000);
    const currentBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, currentBlock - maxBlocks);
    const out: TransferCandidate[] = [];
    const lower = address.toLowerCase();
    const t0 = Date.now();
    let blocksFetched = 0;
    const done = () => {
      // eslint-disable-next-line no-console
      console.info(
        `[scanner] ${network} block-scan: ${blocksFetched} blocks, ${Date.now() - t0}ms, ${out.length} candidates`,
      );
      return out;
    };

    const BATCH = 10;
    for (let top = currentBlock; top >= fromBlock && out.length < 5; top -= BATCH) {
      if (Date.now() > deadline) break;
      const nums: number[] = [];
      for (let b = top; b > Math.max(top - BATCH, fromBlock - 1); b--) nums.push(b);
      const blocks = await Promise.all(
        nums.map((b) => provider.getBlock(b, true).catch(() => null)),
      );
      blocksFetched += blocks.length;
      for (const block of blocks) {
        if (!block?.transactions) continue;
        for (const txItem of block.transactions) {
          if (typeof txItem === 'string') continue;
          const tx = txItem as { to?: string | null; value?: bigint; hash: string; from: string; blockNumber?: number };
          if (!tx.to) continue;
          if (tx.to.toLowerCase() !== lower) continue;
          out.push({
            hash: tx.hash,
            from: tx.from,
            to: tx.to,
            valueEth: ethers.formatEther(tx.value ?? 0n),
            blockNumber: tx.blockNumber ?? 0,
          });
          // Only need first few matches — don't collect unbounded.
          if (out.length >= 5) return done();
        }
      }
    }
    return done();
  }
}

/**
 * Alchemy enhanced-API source (production indexer).
 * Konfigurasi eksplisit (§12) — TIDAK menebak dari string URL:
 *   ALCHEMY_API_KEY=...            (wajib)
 *   ALCHEMY_BASE_RPC_URL=...       (endpoint indexer Base)
 *   ALCHEMY_BSC_RPC_URL=...        (endpoint indexer BSC, bila ada)
 * RPC eksekusi (getBalance/getTransaction) tetap pakai BASE_/BSC_RPC_URL —
 * indexer dan RPC adalah tanggung jawab berbeda.
 */
export class AlchemyHistorySource implements HistorySource {
  name = 'alchemy-asset-transfers';
  private apiKey: string | undefined;
  private indexerUrl: string | undefined;
  constructor(network: NetworkId) {
    this.apiKey = process.env.ALCHEMY_API_KEY?.trim() || undefined;
    const url = network === 'BASE'
      ? process.env.ALCHEMY_BASE_RPC_URL?.trim()
      : process.env.ALCHEMY_BSC_RPC_URL?.trim();
    this.indexerUrl = url || undefined;
  }
  isConfigured(): boolean {
    return !!this.apiKey && !!this.indexerUrl;
  }
  async getRecentTransfers(
    network: NetworkId,
    address: string,
    opts: { maxBlocks: number; timeoutMs?: number },
  ): Promise<TransferCandidate[]> {
    if (!this.isConfigured()) {
      throw new Error(`Alchemy indexer tidak dikonfigurasi untuk ${network} (ALCHEMY_API_KEY + ALCHEMY_${network}_RPC_URL)`);
    }
    const res = await fetch(this.indexerUrl!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'alchemy_getAssetTransfers',
        params: [
          {
            fromBlock: '0x0',
            toAddress: address,
            category: ['external'],
            maxCount: '0x14',
          },
        ],
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
    });
    if (!res.ok) throw new Error(`Alchemy HTTP ${res.status}`);
    const json = (await res.json()) as {
      result?: { transfers?: Array<{ hash: string; from: string; to: string; value?: number; blockNum?: string }> };
    };
    const transfers = json.result?.transfers ?? [];
    // value from Alchemy is in ETH units (number) — keep as string for Decimal compare.
    return transfers.slice(0, 5).map((t) => ({
      hash: t.hash,
      from: t.from,
      to: t.to,
      valueEth: String(t.value ?? '0'),
      blockNumber: t.blockNum ? parseInt(t.blockNum, 16) : 0,
    }));
  }
}

/**
 * Blockscout source — indexer TERBUKA tanpa API key (Base Sepolia).
 * Endpoint dapat dioverride: BLOCKSCOUT_BASE_URL (default Base Sepolia).
 * BSC tidak punya Blockscout publik → otomatis unconfigured → fallback.
 */
export class BlockscoutHistorySource implements HistorySource {
  name = 'blockscout-txlist';
  private baseUrl: string | undefined;
  constructor(network: NetworkId) {
    if (network !== 'BASE') {
      this.baseUrl = undefined;
      return;
    }
    this.baseUrl = process.env.BLOCKSCOUT_BASE_URL?.trim()
      || 'https://base-sepolia.blockscout.com/api';
  }
  isConfigured(): boolean {
    return !!this.baseUrl;
  }
  async getRecentTransfers(
    network: NetworkId,
    address: string,
    opts: { maxBlocks: number; timeoutMs?: number },
  ): Promise<TransferCandidate[]> {
    if (!this.baseUrl) throw new Error(`Blockscout tidak tersedia untuk ${network}`);
    const { ethers } = await import('ethers');
    const url = `${this.baseUrl}?module=account&action=txlist&address=${address}&sort=desc&page=1&offset=10`;
    const res = await fetch(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 8000) });
    if (!res.ok) throw new Error(`Blockscout HTTP ${res.status}`);
    const json = (await res.json()) as {
      status?: string;
      result?: Array<{ hash: string; from: string; to: string; value: string; blockNumber: string; isError: string }>;
    };
    const list = Array.isArray(json.result) ? json.result : [];
    const out: TransferCandidate[] = [];
    for (const t of list) {
      if (!t.to || t.to.toLowerCase() !== address.toLowerCase()) continue;
      if (t.isError === '1') continue; // hanya transfer sukses
      let valueEth = '0';
      try { valueEth = ethers.formatEther(BigInt(t.value ?? '0')); } catch { continue; }
      if (BigInt(t.value ?? '0') <= 0n) continue;
      out.push({
        hash: t.hash,
        from: t.from,
        to: t.to,
        valueEth,
        blockNumber: parseInt(t.blockNumber, 10) || 0,
      });
      if (out.length >= 5) break;
    }
    return out;
  }
}

/**
 * Resolve source per network (§11/§12):
 *   BASE_HISTORY_PROVIDER / BSC_HISTORY_PROVIDER = alchemy | blockscout | block-scan
 *   (default: block-scan). Pilihan tak dikenal / tak terkonfigurasi → fallback
 *   block-scan yang bounded. Pilihan aktif di-log agar operasional jelas.
 */
export type HistoryProviderName = 'alchemy' | 'blockscout' | 'block-scan';

export function getHistorySource(network: NetworkId): HistorySource {
  const raw = (network === 'BASE' ? process.env.BASE_HISTORY_PROVIDER : process.env.BSC_HISTORY_PROVIDER)
    ?.trim().toLowerCase();
  const want: HistoryProviderName =
    raw === 'alchemy' || raw === 'blockscout' || raw === 'block-scan' ? raw : 'block-scan';

  if (want === 'alchemy') {
    const s = new AlchemyHistorySource(network);
    if (s.isConfigured()) {
      // eslint-disable-next-line no-console
      console.info(`[scanner] ${network} history source: alchemy`);
      return s;
    }
  }
  if (want === 'blockscout') {
    const s = new BlockscoutHistorySource(network);
    if (s.isConfigured()) {
      // eslint-disable-next-line no-console
      console.info(`[scanner] ${network} history source: blockscout`);
      return s;
    }
  }
  if (want !== 'block-scan') {
    // eslint-disable-next-line no-console
    console.info(`[scanner] ${network} history source '${want}' unavailable — fallback: block-scan`);
  }
  return new BlockScanHistorySource();
}
