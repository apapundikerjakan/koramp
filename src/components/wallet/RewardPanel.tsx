'use client';

/**
 * RewardPanel — REAL backend data (GET /api/rewards, POST /api/rewards/claim).
 * Phase 3B: PAID claims show the real on-chain hash + explorer link.
 * Non-PAID states never imply arrival; no fake hashes/links.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Gift, AlertTriangle, Info, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { shortAddress, type AssociatedWallet } from '@/lib/walletStore';
import { getWalletToken, clearWalletToken } from '@/lib/useWalletAuth';
import { useSignMessage } from 'wagmi';
import { useWallet as useSolanaWallet } from '@solana/wallet-adapter-react';
import { getTxExplorerUrl } from '@/lib/assets';
import type { NetworkId } from '@/lib/blockchain';

interface Progress {
  cycle: string;
  qualifyingCount: number;
  requiredCount: number;
  minimumTransactionAmount: number;
  progressPercent: number;
  eligible: boolean;
  enabled: boolean;
  claimed: boolean;
  claimStatus: string | null;
  claim: { publicId: string; status: string; rewardUsd: string; network: string; txHash: string | null; createdAt: string } | null;
  configuration: { minTransactionIdr: number; requiredCount: number; rewardMinUsd: string; rewardMaxUsd: string; networks: string[] };
  termsVersion: string;
  payoutActive: boolean;
}

function fmtIdr(n: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

export function RewardPanel({ associations, walletAddress }: { associations: AssociatedWallet[]; walletAddress: string | null }) {
  const [data, setData] = useState<Progress | null>(null);
  const [loading, setLoading] = useState(false);
  const [network, setNetwork] = useState('SOLANA');
  const [destAddr, setDestAddr] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!walletAddress) {
      setData(null);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/rewards?wallet=${encodeURIComponent(walletAddress)}`, { cache: 'no-store' });
      const d = await res.json();
      if (res.ok) {
        setData(d);
        if (!d.configuration.networks.includes(network)) setNetwork(d.configuration.networks[0] ?? 'SOLANA');
      } else {
        toast.error(d.error?.message ?? 'Gagal memuat reward');
      }
    } catch {
      toast.error('Gagal terhubung ke server');
    } finally {
      setLoading(false);
    }
  }, [walletAddress, network]);

  useEffect(() => {
    void load();
  }, [load]);

  const needEco = network === 'SOLANA' ? 'SOLANA' : 'EVM';
  const compatible = useMemo(
    () => associations.filter((w) => w.ecosystem === needEco),
    [associations, needEco],
  );
  const destMismatch = destAddr !== '' && !compatible.some((w) => w.address.toLowerCase() === destAddr.toLowerCase());

  const { signMessageAsync } = useSignMessage();
  const { signMessage: signSol } = useSolanaWallet();

  const claim = async () => {
    if (!walletAddress || !data || claiming) return;
    if (!agreed) {
      setClaimError('Centang persetujuan ketentuan terlebih dahulu.');
      return;
    }
    // Proving ecosystem: progress wallet format decides the signer.
    const eco = walletAddress.startsWith('0x') ? ('EVM' as const) : ('SOLANA' as const);
    const sign = async (message: string): Promise<string> => {
      if (eco === 'EVM') return signMessageAsync({ message });
      if (!signSol) throw new Error('Wallet Solana tidak mendukung tanda tangan.');
      const sig = await signSol(new TextEncoder().encode(message));
      return Array.from(sig).map((b) => b.toString(16).padStart(2, '0')).join('');
    };
    setClaiming(true);
    setClaimError(null);
    try {
      const post = async (token: string) =>
        fetch('/api/rewards/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-wallet-auth': `Bearer ${token}` },
          body: JSON.stringify({ walletAddress, network, destWallet: destAddr, termsAccepted: true }),
        });
      let token: string;
      try {
        token = await getWalletToken({ walletAddress, ecosystem: eco, purpose: 'REWARD_CLAIM', sign });
      } catch (e) {
        setClaimError(e instanceof Error ? e.message : 'Verifikasi wallet gagal.');
        return;
      }
      let res = await post(token);
      if (res.status === 401) {
        // Session rejected once → re-sign and retry a single time.
        clearWalletToken(walletAddress, 'REWARD_CLAIM');
        try {
          token = await getWalletToken({ walletAddress, ecosystem: eco, purpose: 'REWARD_CLAIM', sign });
        } catch (e) {
          setClaimError(e instanceof Error ? e.message : 'Verifikasi wallet gagal.');
          return;
        }
        res = await post(token);
      }
      const d = await res.json();
      if (!res.ok) {
        setClaimError(d.error?.message ?? 'Klaim gagal.');
        return;
      }
      if (d.duplicate) toast.success('Klaim sudah tercatat sebelumnya.');
      else toast.success('Klaim reward tercatat.');
      await load();
    } catch {
      setClaimError('Gagal terhubung ke server.');
    } finally {
      setClaiming(false);
    }
  };

  if (!walletAddress) {
    return <p className="text-gray-600 text-sm">Hubungkan wallet untuk melihat progress reward.</p>;
  }
  if (loading && !data) {
    return (
      <div className="space-y-2 animate-pulse">
        <div className="h-20 bg-line rounded-xl" />
        <div className="h-12 bg-line rounded-xl" />
      </div>
    );
  }
  if (!data) {
    return <p className="text-gray-600 text-sm">Gagal memuat data reward.</p>;
  }

  const canClaim =
    data.enabled && data.eligible && !data.claimed && destAddr !== '' && !destMismatch && agreed && !claiming;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Gift className="w-4 h-4 text-brand-400" aria-hidden />
        <p className="text-white font-bold text-sm">Transaction Reward</p>
      </div>

      {!data.enabled && (
        <p className="text-yellow-500/90 text-xs border border-yellow-500/25 bg-yellow-500/5 rounded-xl px-3 py-2">
          Program reward sedang tidak aktif.
        </p>
      )}

      {/* Progress (real) */}
      <div className="bg-surface-1 border border-line-subtle rounded-xl p-4">
        <div className="flex items-baseline justify-between">
          <p className="text-white font-bold text-lg">
            {data.qualifyingCount} <span className="text-gray-500 text-sm font-normal">/ {data.requiredCount}</span>
          </p>
          <p className="text-gray-600 text-[11px]">Siklus {data.cycle}</p>
        </div>
        <div className="h-2 rounded-full bg-line mt-2 overflow-hidden" role="progressbar" aria-valuenow={data.qualifyingCount} aria-valuemin={0} aria-valuemax={data.requiredCount} aria-label="Progress reward">
          <div className="h-full bg-brand-500/70 rounded-full" style={{ width: `${data.progressPercent}%` }} />
        </div>
        <p className="text-gray-500 text-[11px] mt-2">
          {fmtIdr(data.minimumTransactionAmount)}+ per transaksi ·{' '}
          {data.eligible ? <span className="text-green-400 font-semibold">Reward siap diklaim</span> : 'Not eligible yet'}
        </p>
      </div>

      {/* Claimed state */}
      {data.claimed && data.claim && (
        <div className="bg-brand-600/10 border border-brand-500/30 rounded-xl p-4 text-xs space-y-1">
          {data.claim.status === 'PAID' && data.claim.txHash ? (
            <>
              <p className="text-green-400 font-bold">Reward berhasil dikirim.</p>
              <p className="text-gray-400 font-mono">${data.claim.rewardUsd} · {data.claim.network}</p>
              <a
                href={getTxExplorerUrl((data.claim.network === 'BNB' ? 'BSC' : data.claim.network) as NetworkId, data.claim.txHash)}
                target="_blank"
                rel="noreferrer"
                className="text-brand-400 underline font-mono break-all"
              >
                {data.claim.txHash.slice(0, 20)}… ↗
              </a>
            </>
          ) : (
            <>
              <p className="text-white font-bold">
                {data.claim.status === 'DRY_RUN'
                  ? 'Dry-run validated · payout not active.'
                  : data.claim.status === 'FAILED'
                    ? 'Reward belum berhasil diproses.'
                    : data.claim.status === 'PROCESSING' || data.claim.status === 'SUBMITTED' || data.claim.status === 'CONFIRMING'
                      ? data.claim.status === 'PROCESSING' ? 'Menyiapkan reward...' : data.claim.status === 'SUBMITTED' ? 'Reward telah dikirim ke jaringan.' : 'Menunggu konfirmasi blockchain.'
                      : 'Reward claim recorded. Payout is not yet active.'}
              </p>
              <p className="text-gray-400 font-mono">Reservasi ${data.claim.rewardUsd} · {data.claim.network} · {data.claim.status}</p>
              <p className="text-gray-600">ID: {data.claim.publicId.slice(0, 8)}…</p>
            </>
          )}
        </div>
      )}

      {/* Network */}
      {!data.claimed && (
        <>
          <div>
            <p className="label">Reward Network</p>
            <div className="grid grid-cols-3 gap-2">
              {data.configuration.networks.map((n) => (
                <button
                  key={n}
                  onClick={() => { setNetwork(n); setDestAddr(''); }}
                  className={clsx(
                    'px-2 py-2 rounded-xl text-xs font-bold border',
                    network === n
                      ? 'border-brand-500/50 text-brand-400 bg-brand-600/10'
                      : 'border-line text-gray-500 hover:text-white',
                  )}
                >
                  {n === 'SOLANA' ? 'Solana' : n === 'BNB' ? 'BNB' : 'Base'}
                </button>
              ))}
            </div>
          </div>

          {/* Destination wallet (must equal qualifying wallet — enforced server-side) */}
          <div>
            <p className="label">Receiving Wallet</p>
            {compatible.length === 0 ? (
              <p className="input-field text-sm text-gray-500">Tidak ada wallet {needEco === 'EVM' ? 'EVM' : 'Solana'} yang terhubung.</p>
            ) : (
              <select
                value={destAddr}
                onChange={(e) => setDestAddr(e.target.value)}
                className="input-field text-sm"
                aria-label="Wallet penerima reward"
              >
                <option value="" disabled>Pilih wallet penerima…</option>
                {compatible.map((w) => (
                  <option key={w.address} value={w.address}>{shortAddress(w.address)}</option>
                ))}
              </select>
            )}
            {destMismatch && (
              <p className="text-red-400 text-xs mt-1.5" role="alert">
                Wallet tidak kompatibel dengan network {network} — klaim diblokir.
              </p>
            )}
          </div>

          <label className="flex items-start gap-2.5 text-xs text-gray-400 leading-relaxed cursor-pointer">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 accent-[#C7A048]"
            />
            <span>
              Saya memahami dan menyetujui ketentuan Reward KORAMP. Dengan melanjutkan, saya menyatakan transaksi yang dihitung merupakan transaksi KORAMP yang sah.{' '}
              <Link href="/privacy#reward-program" className="text-brand-400 underline">Lihat ketentuan reward</Link>
            </span>
          </label>

          <button
            onClick={() => { void claim(); }}
            disabled={!canClaim}
            className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {claiming ? (<><Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Memproses…</>) : 'Claim Reward'}
          </button>
          {claimError && (
            <p className="text-red-400 text-xs text-center" role="alert">{claimError}</p>
          )}
          {!data.eligible && (
            <p className="text-gray-600 text-[11px] text-center flex items-center justify-center gap-1">
              <Info className="w-3 h-3" aria-hidden /> Capai {data.requiredCount} transaksi untuk membuka klaim.
            </p>
          )}
        </>
      )}

      {/* Anti-fraud notice */}
      <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-3.5 flex gap-2.5">
        <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" aria-hidden />
        <p className="text-gray-400 text-[11px] leading-relaxed">
          Manipulasi progress, multi-wallet untuk menghindari batasan, atau eksploitasi teknis dapat menyebabkan diskualifikasi dan pembatalan reward. Kelayakan dihitung server-side dari order KORAMP yang sah.{' '}
          <Link href="/privacy#reward-program" className="text-brand-400 underline">Selengkapnya</Link>
        </p>
      </div>
    </div>
  );
}
