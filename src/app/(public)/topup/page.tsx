'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { Navbar } from '@/components/layout/Navbar';
import { useWallet } from '@/contexts/WalletContext';
import { ArrowRight, AlertTriangle, Clock, CheckCircle2, RefreshCw, Copy, Info, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { CHAIN_NAMES, getTxExplorerUrl } from '@/lib/assets';
import { SummaryPanel } from '@/components/order/SummaryPanel';
import { QrCodeCanvas } from '@/components/ui/QrCodeCanvas';
import { TerminalGrid, ChartPanelSkeleton, ChartToggleButton, useChartToggle } from '@/components/order/TerminalLayout';
import { DEFAULT_CHART_ASSET } from '@/lib/tradingView';
import { TokenIcon } from '@/components/ui/TokenIcon';
import {
  QrFrame, ToolChip, StreamingText,
  AnimatedCounter, ParticleBurst, ShimmerText,
} from '@/components/ui/motion';

type Asset = 'SOL' | 'ETH' | 'BNB';
type Step = 'connect' | 'asset' | 'amount' | 'confirm' | 'payment' | 'success';

const ASSET_INFO = {
  SOL: { color: 'text-purple-400', border: 'border-purple-500/30', bg: 'bg-purple-500/10', network: 'Solana Network', networkId: 'SOLANA', walletType: 'SOLANA' },
  ETH: { color: 'text-blue-400', border: 'border-blue-500/30', bg: 'bg-blue-500/10', network: 'Base Sepolia', networkId: 'BASE', walletType: 'EVM' },
  BNB: { color: 'text-yellow-400', border: 'border-yellow-500/30', bg: 'bg-yellow-500/10', network: 'BSC Testnet', networkId: 'BSC', walletType: 'EVM' },
} as const;

function fmt(n: string | number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(n));
}
function fmtCrypto(n: string | number): string {
  return parseFloat(Number(n).toFixed(8)).toString();
}

// Trading-terminal chart — client-only (TradingView embed needs window/document).
const TerminalChart = dynamic(
  () => import('@/components/ui/TradingViewAdvancedChart').then((m) => ({ default: m.TradingViewTerminalChart })),
  { ssr: false, loading: () => <ChartPanelSkeleton /> },
);

export default function TopUpPage() {
  const router = useRouter();
  const { address, evmAddress, evmChainId, solAddress, isConnected, setShowConnectModal, openEvmModal, isCorrectNetworkForAsset, ensureChainForAsset } = useWallet();

  const searchParams = useSearchParams();
  const queryAsset = searchParams.get('asset');
  const queryAmount = searchParams.get('amount') ?? '';
  const handoffAsset: Asset | null =
    queryAsset === 'SOL' || queryAsset === 'ETH' || queryAsset === 'BNB' ? queryAsset : null;
  const hasHandoff = handoffAsset !== null && queryAmount !== '' && Number(queryAmount) > 0;

  const [step, setStep] = useState<Step>(hasHandoff ? 'amount' : 'asset');
  const [asset, setAsset] = useState<Asset | null>(handoffAsset);
  const [idrInput, setIdrInput] = useState(hasHandoff ? queryAmount : '');
  const [quote, setQuote] = useState<any>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [order, setOrder] = useState<any>(null);
  const [payment, setPayment] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const [qrError, setQrError] = useState(false);
  const [quoteExpiry, setQuoteExpiry] = useState(0);

  // Trading-terminal chart (left column) — preference persisted, mobile defaults closed.
  const { chartOpen, toggleChart } = useChartToggle();
  const isChartStep = step === 'asset' || step === 'amount' || step === 'confirm';

  const [quoteRefreshing, setQuoteRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  // Track whether crypto delivery is confirmed on success step.
  const [cryptoConfirmed, setCryptoConfirmed] = useState(false);
  const [cryptoTxHash, setCryptoTxHash] = useState<string | null>(null);

  // Polling refs — must be declared at component level (Rules of Hooks).
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollBackoffRef = useRef<number>(3000);
  const deliveryIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-refresh quote every 60s — silent, stays on confirm step
  const autoRefreshQuote = useCallback(async () => {
    if (!asset || !idrInput || step !== 'confirm') return;
    if (refreshingRef.current) return; // guard: never overlap refreshes (prevents quote spam)
    refreshingRef.current = true;
    setQuoteRefreshing(true);
    try {
      const res = await fetch('/api/quotes/topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset, network: ASSET_INFO[asset].networkId, idrAmount: idrInput }),
      });
      const data = await res.json();
      if (res.ok) {
        setQuote(data.quote);
        // reset expiry will be handled by the existing countdown useEffect
      }
    } catch { /* silent — keep showing old quote */ }
    finally { setQuoteRefreshing(false); refreshingRef.current = false; }
  }, [asset, idrInput, step]);

  // Countdown timer — auto-refresh when expired
  useEffect(() => {
    if (!quote?.expiresAt) return;
    const tick = () => {
      const secs = Math.max(0, Math.floor((new Date(quote.expiresAt).getTime() - Date.now()) / 1000));
      setQuoteExpiry(secs);
      if (secs === 0 && step === 'confirm') {
        autoRefreshQuote();
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [quote?.expiresAt, step, autoRefreshQuote]);

  // Auto-poll order status when in payment step.
  // Uses /payment-status to trigger server-to-server Xendit verification —
  // not just a DB read. This is essential when webhook cannot reach localhost
  // (development) or when webhook delivery is delayed.
  useEffect(() => {
    if (step !== 'payment' || !order?.publicId) return;

    const poll = async () => {
      try {
        // payment-status triggers a server-side GET to Xendit, then updates DB.
        const res = await fetch(`/api/orders/${order.publicId}/payment-status`);
        const data = await res.json();
        const status = data.status ?? order.status;
        if (status === 'PAYMENT_CONFIRMED' || status === 'CRYPTO_PROCESSING' || status === 'COMPLETED') {
          setOrder((prev: any) => ({ ...prev, status }));
          setStep('success');
          return;
        }
        if (status === 'PAYMENT_FAILED' || status === 'PAYMENT_CREATE_FAILED' || status === 'PAYMENT_CREATE_UNKNOWN' || status === 'EXPIRED') {
          setOrder((prev: any) => ({ ...prev, status }));
          setStep('confirm');
          return;
        }
      } catch {}
    };

    const schedule = () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = setInterval(poll, pollBackoffRef.current);
      pollBackoffRef.current = Math.min(15000, pollBackoffRef.current + 1000);
    };

    // Mulai 6s (= limit payment-status 10/min) lalu backoff ke 15s.
    pollBackoffRef.current = 6000;
    poll();
    schedule();

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [step, order?.publicId, order?.status]);

  // Poll check-delivery when on success step until crypto is COMPLETED.
  useEffect(() => {
    if (step !== 'success' || !order?.publicId || cryptoConfirmed) return;

    const check = async () => {
      try {
        const res = await fetch(`/api/orders/${order.publicId}/check-delivery`, { method: 'POST' });
        const data = await res.json();
        if (data.status === 'COMPLETED') {
          setCryptoConfirmed(true);
          if (data.txHash) setCryptoTxHash(data.txHash);
          if (deliveryIntervalRef.current) {
            clearInterval(deliveryIntervalRef.current);
            deliveryIntervalRef.current = null;
          }
        }
      } catch { /* silent */ }
    };

    check(); // immediate first check
    // 12s = 5 req/min, di bawah limit check-delivery 6/min.
    deliveryIntervalRef.current = setInterval(check, 12000);

    return () => {
      if (deliveryIntervalRef.current) {
        clearInterval(deliveryIntervalRef.current);
        deliveryIntervalRef.current = null;
      }
    };
  }, [step, order?.publicId, cryptoConfirmed]);

  const getQuote = async () => {
    if (!asset || !idrInput) return;
    setQuoteLoading(true);
    try {
      const res = await fetch('/api/quotes/topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset, network: ASSET_INFO[asset].networkId, idrAmount: idrInput }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error?.message ?? 'Gagal mendapatkan quote'); return; }
      setQuote(data.quote);
      setStep('confirm');
    } catch { toast.error('Gagal terhubung ke server'); }
    finally { setQuoteLoading(false); }
  };

  // Handoff from /topup-sell (?asset=&amount=): fetch a fresh quote on mount
  // and land directly on confirm. Fresh quote avoids expiry races.
  const handoffRef = useRef(hasHandoff);
  useEffect(() => {
    if (handoffRef.current) {
      handoffRef.current = false;
      void getQuote();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createOrder = async () => {
    if (!quote || !asset) return;
    if (!resolvedAddress) {
      toast.error('Wallet tidak terhubung. Hubungkan kembali sebelum melanjutkan.');
      if (asset && ASSET_INFO[asset].walletType === 'SOLANA') {
        setShowConnectModal(true);
      } else {
        openEvmModal();
      }
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/orders/topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: resolvedAddress,
          walletType: resolvedWalletType,
          quoteId: quote.quoteId,
          asset,
          network: ASSET_INFO[asset].networkId,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error?.message ?? 'Gagal membuat order'); return; }
      setOrder(data.order);
      setPayment(data.payment);
      setStep('payment');
    } catch { toast.error('Gagal terhubung ke server'); }
    finally { setSubmitting(false); }
  };

  const simulatePay = async (status: 'fund_deposited' | 'asset_settled' = 'fund_deposited') => {
    if (!order?.publicId) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/payments/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderPublicId: order.publicId, status }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error?.message ?? 'Simulasi gagal'); return; }
      toast.success('Pembayaran disimulasikan!');
    } catch { toast.error('Simulasi gagal'); }
    finally { setSubmitting(false); }
  };

  const info = asset ? ASSET_INFO[asset] : null;
  const walletOk = asset ? isCorrectNetworkForAsset(asset) : false;
  const detectedEvmNetwork = evmChainId != null
    ? (CHAIN_NAMES[evmChainId] ?? `Chain ${evmChainId}`)
    : null;

  // Auto-detect + auto-switch: user pilih asset EVM sementara wallet ada di
  // chain lain → langsung minta switch ke wallet (tanpa klik tombol tambahan).
  const handleSelectAsset = (a: Asset) => {
    setAsset(a);
    if (ASSET_INFO[a].walletType === 'EVM') {
      ensureChainForAsset(a).then((ok) => {
        if (!ok) toast.error('Wallet belum di jaringan yang benar. Klik tombol Switch di bawah.');
      });
    }
  };
  const resolvedAddress = asset
    ? (ASSET_INFO[asset].walletType === 'SOLANA' ? solAddress : evmAddress)
    : address;
  const resolvedWalletType = asset ? ASSET_INFO[asset].walletType : null;

  return (
    <div className="h-dvh flex flex-col overflow-hidden bg-base">
      <Navbar />
      <div className="flex-1 min-h-0 mx-auto w-full max-w-[1600px] px-4 sm:px-6 py-3 sm:py-4 flex flex-col">
        {/* Header */}
        <div className="mb-3 flex-shrink-0">
          <div className="flex items-center justify-between gap-3 mb-0.5">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-brand-600/20 rounded-xl flex items-center justify-center flex-shrink-0">
                <span className="text-brand-400 font-black">↑</span>
              </div>
              <h1 className="text-xl font-black text-white">Top Up Crypto</h1>
            </div>
            {isChartStep && <ChartToggleButton open={chartOpen} onToggle={toggleChart} />}
          </div>
          <p className="text-gray-500 text-xs sm:pl-11 hidden sm:block">IDR → Crypto. Bayar dengan <span className="text-brand-400 font-semibold">QRIS</span> — GoPay, OVO, ShopeePay, m-banking.</p>
        </div>

        <div className="flex-1 min-h-0 flex flex-col">

        {/* ── STEP: ASSET ─────────────────────────────────────── */}
        {step === 'asset' && (
          <TerminalGrid open={chartOpen} chart={<TerminalChart symbol={asset ?? DEFAULT_CHART_ASSET} />} summary={<SummaryPanel variant="topup" asset={asset} networkLabel={info?.network} quote={null} />}>
          <div className="space-y-4">
            <p className="text-gray-400 text-sm font-semibold">Pilih crypto yang ingin dibeli</p>
            <div className="space-y-3">
              {(['SOL', 'ETH', 'BNB'] as Asset[]).map(a => {
                const ai = ASSET_INFO[a];
                const glow = a === 'SOL' ? 'glow-sol' : a === 'ETH' ? 'glow-eth' : 'glow-bnb';
                return (
                  <button key={a} onClick={() => handleSelectAsset(a)} type="button"
                    aria-pressed={asset === a}
                    className={clsx('w-full flex items-center gap-4 p-4 rounded-2xl border-2 text-left asset-lift',
                      glow,
                      asset === a
                        ? 'selected border-brand-500 bg-brand-600/10 glass shadow-brand-glow'
                        : `border-line-subtle hover:bg-surface-2`
                    )}>
                    <div className={clsx('w-12 h-12 rounded-xl border flex items-center justify-center', ai.bg, ai.border)}>
                      <TokenIcon symbol={a} size={26} />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className={clsx('font-bold text-base', ai.color)}>{a}</span>
                        {asset === a && <CheckCircle2 className="w-4 h-4 text-brand-400" />}
                      </div>
                      <p className="text-gray-400 text-sm">{ai.network}</p>
                    </div>
                    <div className={clsx('text-xs px-2 py-0.5 rounded-full border', ai.bg, ai.border, ai.color)}>
                      {ai.walletType === 'EVM' ? 'EVM Wallet' : 'Solana Wallet'}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Wallet check */}
            {asset && !isConnected && (
              <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-xl flex items-start gap-3">
                <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-yellow-400 text-sm font-semibold">Wallet belum terhubung</p>
                  <p className="text-gray-400 text-xs mt-1">Hubungkan {info?.walletType === 'EVM' ? 'EVM wallet (MetaMask/Rabby)' : 'Solana wallet (Phantom/Solflare)'} untuk melanjutkan.</p>
                  <button onClick={() => info?.walletType === 'SOLANA' ? setShowConnectModal(true) : openEvmModal()} className="mt-2 text-brand-400 text-xs underline">Hubungkan wallet →</button>
                </div>
              </div>
            )}

            {asset && isConnected && !walletOk && (
              <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3">
                <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-red-400 text-sm">
                    {info?.walletType === 'SOLANA'
                      ? 'Hubungkan Solana wallet (Phantom/Solflare) untuk membeli SOL.'
                      : <>Wallet Anda terdeteksi di <strong>{detectedEvmNetwork ?? 'network yang tidak didukung'}</strong> — switch ke <strong>{info?.network}</strong> untuk lanjut.</>}
                  </p>
                  {info?.walletType === 'EVM' && (
                    <button
                      onClick={() => { ensureChainForAsset(asset).then((ok) => { if (!ok) toast.error('Switch gagal. Coba lagi atau ganti manual di wallet.'); }); }}
                      className="mt-2 w-full py-2 text-xs font-semibold rounded-lg border text-yellow-400 border-yellow-500/30 bg-yellow-500/10 hover:opacity-80 transition-all"
                    >
                      Switch ke {info?.network} →
                    </button>
                  )}
                </div>
              </div>
            )}

            <button className="btn-primary w-full" disabled={!asset || !isConnected || !walletOk}
              onClick={() => setStep('amount')}>
              Lanjut <ArrowRight className="w-4 h-4 inline ml-1" />
            </button>
          </div>
          </TerminalGrid>
        )}

        {/* ── STEP: AMOUNT ─────────────────────────────────── */}
        {step === 'amount' && asset && (
          <TerminalGrid open={chartOpen} chart={<TerminalChart symbol={asset ?? DEFAULT_CHART_ASSET} />} summary={<SummaryPanel variant="topup" asset={asset} networkLabel={info?.network} quote={null} />}>
          <div className="space-y-5">
            <button onClick={() => setStep('asset')} className="text-gray-500 hover:text-white text-sm flex items-center gap-1">← Kembali</button>

            <div className="flex items-center gap-3 p-4 bg-surface-1 rounded-xl border border-line-subtle">
              <TokenIcon symbol={asset} size={26} />
              <div>
                <p className={clsx('font-bold', info?.color)}>{asset} — {info?.network}</p>
                <p className="text-gray-500 text-xs">Wallet: {resolvedAddress?.slice(0, 8)}...{resolvedAddress?.slice(-4)}</p>
              </div>
            </div>

            <div>
              <label className="label">Nominal IDR</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-semibold">Rp</span>
                <input
                  type="number" className="input-field pl-10 text-lg font-semibold"
                  placeholder="500000" value={idrInput}
                  onChange={e => setIdrInput(e.target.value)}
                  min="50000" step="10000"
                />
              </div>
              <p className="text-gray-600 text-xs mt-1.5">Minimum Rp50.000 · Maximum Rp100.000.000</p>
            </div>

            {/* Quick amounts */}
            <div className="grid grid-cols-4 gap-2">
              {['100000', '250000', '500000', '1000000'].map(v => (
                <button key={v} onClick={() => setIdrInput(v)}
                  className={clsx('py-2 px-2 rounded-lg text-xs font-semibold border transition-all',
                    idrInput === v ? 'bg-brand-600/20 border-brand-500 text-brand-400' : 'bg-surface-1 border-line-subtle text-gray-400 hover:border-line-strong'
                  )}>
                  {fmt(v).replace('Rp', '').replace('.', '').trim().slice(0, 5)}rb
                </button>
              ))}
            </div>

            <button className="btn-primary w-full" disabled={!idrInput || quoteLoading}
              onClick={getQuote}>
              {quoteLoading ? <><RefreshCw className="w-4 h-4 animate-spin inline mr-2" />Menghitung...</> : 'Dapatkan Quote →'}
            </button>
            {quoteLoading && (
              <p className="text-center text-sm" role="status">
                <ShimmerText>Mengambil harga pasar terbaru...</ShimmerText>
              </p>
            )}
          </div>
          </TerminalGrid>
        )}

        {/* ── STEP: CONFIRM ────────────────────────────────── */}
        {step === 'confirm' && quote && asset && (
          <TerminalGrid open={chartOpen} chart={<TerminalChart symbol={asset ?? DEFAULT_CHART_ASSET} />} summary={<SummaryPanel variant="topup" asset={asset} networkLabel={info?.network} quote={quote} quoteExpiry={quoteExpiry} quoteRefreshing={quoteRefreshing} />}>
          <div className="space-y-5">
            <button onClick={() => setStep('amount')} className="text-gray-500 hover:text-white text-sm">← Kembali</button>

            {/* Anda bayar — ringkas, rincian penuh ada di panel */}
            <div className="bg-surface-1 border border-line-subtle rounded-2xl p-5 flex justify-between items-center">
              <span className="text-gray-400 text-sm">Anda bayar</span>
              <span className="tnum text-white font-bold text-lg">{fmt(quote.totalIdr)}</span>
            </div>

            {/* SOL ATA fee notice */}
            {asset === 'SOL' && quote.solAtaFeeSol && parseFloat(quote.solAtaFeeSol) > 0 && (
              <div className="flex items-start gap-2 p-3 bg-purple-500/10 border border-purple-500/20 rounded-xl">
                <TokenIcon symbol="SOL" size={14} />
                <p className="text-purple-300 text-xs">
                  Termasuk biaya ATA (Associated Token Account): <strong className="text-white">{parseFloat(quote.solAtaFeeSol).toFixed(4)} SOL</strong> dipotong dari SOL yang diterima untuk memastikan transaksi berhasil.
                </p>
              </div>
            )}

            {/* Wallet destination */}
            <div className="p-4 bg-surface-1 border border-line-subtle rounded-xl">
              <p className="text-gray-500 text-xs mb-1">Crypto dikirim ke wallet Anda</p>
              <p className="text-white font-mono text-sm break-all">{resolvedAddress}</p>
            </div>

            {/* Quote expiry countdown tampil di panel Ringkasan di bawah —
                tidak diduplikasi di sini. */}

            <button className="btn-primary w-full text-base py-3.5" disabled={submitting || quoteRefreshing || quoteExpiry === 0}
              onClick={createOrder}>
              {submitting ? <><RefreshCw className="w-4 h-4 animate-spin inline mr-2" />Membuat order...</> : quoteExpiry === 0 ? 'Memperbarui harga...' : `Bayar ${fmt(quote.totalIdr)} →`}
            </button>
          </div>
          </TerminalGrid>
        )}

        {/* ── STEP: PAYMENT ────────────────────────────────── */}
        {step === 'payment' && order && payment && (
          <div className="space-y-5 animate-fade-in max-w-lg mx-auto w-full h-full min-h-0 overflow-y-auto pb-4">
            <div className="text-center">
              <div className="w-14 h-14 bg-yellow-500/20 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <Clock className="w-7 h-7 text-yellow-400 animate-pulse" />
              </div>
              <h2 className="text-xl font-black text-white">Scan & Bayar QRIS</h2>
              <p className="text-gray-400 text-sm mt-1">Scan dengan aplikasi e-wallet atau m-banking</p>
            </div>

            {/* Supported payment apps */}
            <div className="bg-surface-1 border border-line-subtle rounded-xl p-3">
              <p className="text-gray-500 text-xs mb-2 text-center">Didukung oleh semua aplikasi QRIS</p>
              <div className="flex flex-wrap justify-center gap-x-3 gap-y-1">
                {['GoPay', 'OVO', 'ShopeePay', 'DANA', 'LinkAja', 'iSaku', 'Jenius', 'BCA', 'BRI', 'BNI', 'Mandiri', 'Bank lain'].map(app => (
                  <span key={app} className="text-gray-400 text-xs">{app}</span>
                ))}
              </div>
            </div>

            {/* Status chip (AICSS thinking pattern) */}
            <div className="flex justify-center">
              <ToolChip state="running">Menunggu pembayaran...</ToolChip>
            </div>

            {/* QRIS Image — rendered from Xendit QR string (client-side) */}
            <QrFrame waiting={!qrError} confirmed={false} caption="QRIS payment">
              {!qrError && payment.qrPayload ? (
                <QrCodeCanvas payload={payment.qrPayload} />
              ) : !qrError && payment.payUrl ? (
                <div className="w-60 min-h-60 flex flex-col items-center justify-center gap-3 text-gray-300 p-6 text-center">
                  <p className="text-sm">Selesaikan pembayaran di halaman berikut</p>
                  <a href={payment.payUrl} target="_blank" rel="noreferrer" className="text-sm text-brand-400 underline">
                    Buka halaman pembayaran →
                  </a>
                </div>
              ) : (
                <div className="w-60 h-60 flex flex-col items-center justify-center gap-2 text-gray-400">
                  <p className="text-sm text-center">QR belum tersedia</p>
                  <p className="text-xs text-gray-500 text-center">Memuat ulang...</p>
                  <button
                    type="button"
                    className="mt-1 text-xs text-brand-400 underline"
                    onClick={() => { setQrError(false); }}
                  >
                    Muat ulang QR
                  </button>
                </div>
              )}
            </QrFrame>

            {/* Payment details */}
            <div className="bg-surface-1 border border-line-subtle rounded-xl p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Total bayar</span>
                <span className="text-white font-bold text-base">{fmt(payment.grossAmount)}</span>
              </div>
              {payment.uniqueCode > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Termasuk kode unik</span>
                  <span className="text-gray-400">+{payment.uniqueCode}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Order</span>
                <span className="text-gray-300 font-mono text-xs">{order.orderNumber}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Berlaku sampai</span>
                <span className="text-yellow-400 text-xs font-semibold">
                  {payment.expiresAt ? new Date(payment.expiresAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-'}
                </span>
              </div>
            </div>              <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl flex items-start gap-2">
              <Info className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
              <p className="text-blue-300 text-xs">
                Bayar <strong>tepat</strong> sesuai nominal di atas.
                Status diperbarui otomatis setelah konfirmasi. Jangan tutup halaman ini.
              </p>
            </div>

            {order.status === 'PAYMENT_CREATE_FAILED' || order.status === 'PAYMENT_CREATE_UNKNOWN' || order.status === 'PAYMENT_FAILED' || order.status === 'EXPIRED' ? (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-red-300 text-xs">
                  {order.status === 'PAYMENT_CREATE_FAILED'
                    ? 'Layanan pembayaran tidak tersedia. Silakan buat order baru.'
                    : order.status === 'PAYMENT_CREATE_UNKNOWN'
                      ? 'Status pembayaran tidak pasti. Jangan bayar apa pun. Buat order baru.'
                      : order.status === 'EXPIRED'
                        ? 'QRIS kadaluarsa. Buat order baru.'
                        : 'Pembayaran gagal. Buat order baru.'}
                </p>
              </div>
            ) : null}

            <button
              onClick={() => router.push(`/order/${order.publicId}`)}
              className="btn-ghost w-full text-sm text-center"
            >
              Lihat status order →
            </button>

            {/* Dev sandbox simulate */}
            {process.env.NODE_ENV !== 'production' && (
              <div className="grid grid-cols-2 gap-2">
                <button className="py-2 px-4 rounded-xl border border-yellow-600/30 bg-yellow-600/10 text-yellow-400 text-xs font-semibold disabled:opacity-50"
                  disabled={submitting} onClick={() => { void simulatePay('fund_deposited'); }}>
                  {submitting ? 'Memproses...' : '🧪 [Sandbox] Simulasi Bayar'}
                </button>
                <button className="py-2 px-4 rounded-xl border border-yellow-600/30 bg-yellow-600/10 text-yellow-400 text-xs font-semibold disabled:opacity-50"
                  disabled={submitting} onClick={() => { void simulatePay('asset_settled'); }}>
                  {submitting ? 'Memproses...' : '🧪 [Sandbox] Simulasi Settlement'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── STEP: SUCCESS ─────────────────────────────────── */}
        {step === 'success' && (
          <div className="relative text-center space-y-5 animate-fade-in max-w-lg mx-auto w-full h-full min-h-0 overflow-y-auto pb-4">
            {cryptoConfirmed && <ParticleBurst />}
            <div className={clsx(
              'w-20 h-20 rounded-full flex items-center justify-center mx-auto',
              cryptoConfirmed ? 'bg-green-500/20' : 'bg-brand-600/20'
            )}>
              {cryptoConfirmed
                ? <CheckCircle2 className="w-10 h-10 text-green-400" />
                : <RefreshCw className="w-10 h-10 text-brand-400 animate-spin" />}
            </div>
            <div>
              {cryptoConfirmed ? (
                <>
                  <h2 className="text-2xl font-black text-white">Crypto Terkirim! 🎉</h2>
                  <p className="text-gray-400 text-sm mt-2">
                    {fmtCrypto(order?.cryptoAmount)} {asset} telah dikirim ke wallet Anda.
                  </p>
                </>
              ) : (
                <>
                  <h2 className="text-2xl font-black text-white">Pembayaran Dikonfirmasi!</h2>
                  <p className="text-gray-400 text-sm mt-2">
                    <StreamingText text="Crypto sedang dikirim ke wallet Anda. Menunggu konfirmasi blockchain..." />
                  </p>
                </>
              )}
            </div>
            {order && (
              <div className="bg-surface-1 border border-line-subtle rounded-xl p-5 text-left space-y-3">
                <div className="flex justify-between text-sm"><span className="text-gray-500">Order</span><span className="text-white font-mono text-xs">{order.orderNumber}</span></div>
                <div className="flex justify-between text-sm"><span className="text-gray-500">Asset</span><span className={info?.color}>{asset} — {info?.network}</span></div>
                <div className="flex justify-between text-sm"><span className="text-gray-500">Jumlah</span><AnimatedCounter value={parseFloat(order.cryptoAmount) || 0} format={(n) => `${fmtCrypto(n)} ${asset}`} className="text-white font-bold" /></div>
                <div className="flex justify-between text-sm"><span className="text-gray-500">Wallet</span><span className="text-white font-mono text-xs">{resolvedAddress?.slice(0, 10)}...{resolvedAddress?.slice(-4)}</span></div>
                {(cryptoTxHash ?? order.cryptoTxHash) && (() => {
                  const txHash = cryptoTxHash ?? order.cryptoTxHash;
                  const explorerUrl = asset ? getTxExplorerUrl(ASSET_INFO[asset].networkId, txHash) : null;
                  return (
                    <div className="flex justify-between text-sm items-center gap-2">
                      <span className="text-gray-500 flex-shrink-0">TX Hash</span>
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-brand-400 font-mono text-xs truncate">
                          {txHash.slice(0, 18)}…
                        </span>
                        {explorerUrl && (
                          <a
                            href={explorerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Lihat di blockchain explorer"
                            className="flex-shrink-0 text-brand-400 hover:text-brand-300 transition-colors"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })()}
                {!cryptoConfirmed && (
                  <div className="flex items-center gap-2 pt-1">
                    <RefreshCw className="w-3 h-3 text-brand-400 animate-spin flex-shrink-0" />
                    <p className="text-brand-400 text-xs">Memverifikasi di blockchain (cek otomatis setiap 8 detik)</p>
                  </div>
                )}
              </div>
            )}
            <div className="flex gap-3">
              <button onClick={() => router.push(`/order/${order?.publicId}`)} className="btn-secondary flex-1 text-sm">Lacak Order</button>
              <button onClick={() => {
                setStep('asset'); setAsset(null); setQuote(null); setOrder(null); setPayment(null);
                setIdrInput(''); setCryptoConfirmed(false); setCryptoTxHash(null);
              }} className="btn-primary flex-1 text-sm">Top Up Lagi</button>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
