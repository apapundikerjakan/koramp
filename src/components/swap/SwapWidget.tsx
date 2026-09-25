'use client';

/**
 * SwapWidget — unified Top Up / Sell experience on ONE page.
 *
 * Quote (direction flip, token modal, auto-quote) → confirm → processing
 * (BUY: QRIS scan + polling / SELL: wallet send + polling) → success,
 * all inline. Only "Lacak Order" navigates (/order/[publicId]).
 * Quote/order/payment endpoints reused untouched; summary logic reused.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useWallet } from '@/contexts/WalletContext';
import { useWalletSelection } from '@/lib/useWalletSelection';
import { CHAIN_NAMES } from '@/lib/assets';
import { SummaryPanel } from '@/components/order/SummaryPanel';
import { QrCodeCanvas } from '@/components/ui/QrCodeCanvas';
import { TerminalGrid, ChartPanelSkeleton, useChartToggle } from '@/components/order/TerminalLayout';
import { DEFAULT_CHART_ASSET } from '@/lib/tradingView';
import { ASSET_INFO, type Asset } from '@/components/ui/AssetCard';
import { QrFrame, ToolChip, ShimmerText, AnimatedCounter, ParticleBurst } from '@/components/ui/motion';
import { TokenSelector, IdrSelector } from './TokenSelector';
import { SwapDirectionButton } from './SwapDirectionButton';
import {
  ArrowRight, AlertTriangle, Clock, CheckCircle2, RefreshCw,
  Copy, Check, Info, Loader2, Send, ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';
import clsx from 'clsx';

type Direction = 'BUY' | 'SELL';
type Stage = 'quote' | 'bank' | 'confirm' | 'processing' | 'success';

const NET: Record<Asset, { networkId: 'SOLANA' | 'BASE' | 'BSC'; walletType: 'SOLANA' | 'EVM' }> = {
  SOL: { networkId: 'SOLANA', walletType: 'SOLANA' },
  ETH: { networkId: 'BASE', walletType: 'EVM' },
  BNB: { networkId: 'BSC', walletType: 'EVM' },
};

const POPULAR_BANKS = ['BCA', 'BRI', 'BNI', 'Mandiri'];

function fmtIDR(n: string | number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(n));
}
function fmtC(n: string | number): string {
  return parseFloat(Number(n).toFixed(8)).toString();
}

const TerminalChart = dynamic(
  () => import('@/components/ui/TradingViewAdvancedChart').then((m) => ({ default: m.TradingViewTerminalChart })),
  { ssr: false, loading: () => <ChartPanelSkeleton /> },
);

export function SwapWidget() {
  const router = useRouter();
  const {
    evmChainId, solAddress, evmAddress, isConnected,
    evmConnected, solConnected,
    setShowConnectModal, openEvmModal,
    isCorrectNetworkForAsset, ensureChainForAsset, sendCrypto,
  } = useWallet();

  const [direction, setDirection] = useState<Direction>('BUY');
  const [asset, setAsset] = useState<Asset>('SOL');
  const [payInput, setPayInput] = useState('');
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [fiatOpen, setFiatOpen] = useState(false);
  const [stage, setStage] = useState<Stage>('quote');
  const [quote, setQuote] = useState<any>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteExpiry, setQuoteExpiry] = useState(0);
  const [quoteRefreshing, setQuoteRefreshing] = useState(false);
  // Order limits follow the admin dashboard (Min/Max Order IDR) via /api/prices.
  const [limits, setLimits] = useState({ min: 50000, max: 100000000 });

  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');

  const [order, setOrder] = useState<any>(null);
  const [payment, setPayment] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const [qrError, setQrError] = useState(false);

  // Sell send state
  const [sendingTx, setSendingTx] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [depositStatus, setDepositStatus] = useState<'waiting' | 'detected' | 'confirming' | 'confirmed'>('waiting');
  const [depositConfs, setDepositConfs] = useState<{ current: number; required: number } | null>(null);

  // Buy success state
  const [cryptoConfirmed, setCryptoConfirmed] = useState(false);
  const [cryptoTxHash, setCryptoTxHash] = useState<string | null>(null);

  const { chartOpen } = useChartToggle();
  const refreshingRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const meta = NET[asset];
  const info = ASSET_INFO[asset];
  const walletOk = isCorrectNetworkForAsset(asset);
  const liveEvm = evmConnected && evmAddress ? evmAddress : null;
  const liveSol = solConnected && solAddress ? solAddress : null;
  const liveForAsset = meta.walletType === 'SOLANA' ? liveSol : liveEvm;
  // Deterministic per-ecosystem selection: one wallet → auto, many → explicit.
  // The SELECTED wallet (not silently the live one) funds the transaction.
  const { evm: evmSel, sol: solSel } = useWalletSelection(liveEvm, liveSol);
  const assetSel = meta.walletType === 'SOLANA' ? solSel : evmSel;
  const selectedAddress = assetSel.selected;
  const resolvedAddress = selectedAddress;
  const selectedMismatch =
    !!selectedAddress && (!liveForAsset || liveForAsset.toLowerCase() !== selectedAddress.toLowerCase());
  const detectedEvmNetwork = evmChainId != null ? (CHAIN_NAMES[evmChainId] ?? `Chain ${evmChainId}`) : null;

  const isBuy = direction === 'BUY';
  const payIsIdr = isBuy;
  const receiveCrypto = isBuy && quote ? fmtC(quote.cryptoAmount) : '';
  const receiveIdr = !isBuy && quote ? fmtIDR(quote.totalIdrPayout ?? quote.totalIdr ?? quote.idrAmount) : '';

  useEffect(() => {
    fetch('/api/prices', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (d?.limits) {
          setLimits({
            min: Number(d.limits.minOrderIdr) || 50000,
            max: Number(d.limits.maxOrderIdr) || 100000000,
          });
        }
      })
      .catch(() => { /* keep server defaults */ });
  }, []);

  // ─── Quote (debounced auto-fetch, existing quote endpoints) ────────────────
  // Returns the quote on success (state is also updated), null otherwise.
  const fetchQuote = useCallback(async (dir: Direction, a: Asset, input: string, silent = false): Promise<any | null> => {
    if (!input || Number(input) <= 0) {
      setQuote(null);
      return null;
    }
    if (dir === 'BUY' && Number(input) < limits.min) {
      setQuote(null);
      return null;
    }
    if (!silent) {
      setQuoteLoading(true);
      setQuoteError(null);
    } else {
      if (refreshingRef.current) return null;
      refreshingRef.current = true;
      setQuoteRefreshing(true);
    }
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 20000);
    try {
      const url = dir === 'BUY' ? '/api/quotes/topup' : '/api/quotes/sell';
      const body = dir === 'BUY'
        ? { asset: a, network: NET[a].networkId, idrAmount: input }
        : { asset: a, network: NET[a].networkId, cryptoAmount: input };
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
      const data = await res.json();
      if (res.ok) {
        setQuote(data.quote);
        setQuoteError(null);
        return data.quote;
      }
      if (!silent) {
        const msg = data.error?.message ?? 'Gagal mendapatkan quote';
        setQuoteError(msg);
        toast.error(msg);
      }
      return null;
    } catch (err: any) {
      if (!silent) {
        const msg = err?.name === 'AbortError'
          ? 'Mengambil harga terlalu lama. Coba lagi.'
          : 'Gagal terhubung ke server';
        setQuoteError(msg);
        toast.error(msg);
      }
      return null;
    } finally {
      clearTimeout(timeout);
      if (!silent) setQuoteLoading(false);
      else {
        setQuoteRefreshing(false);
        refreshingRef.current = false;
      }
    }
  }, [limits.min]);

  // Quote auto-fetch runs ONLY in the quote stage. Returning before
  // setQuote(null) is critical: wiping the quote on stage change would
  // blank the confirm screen (it renders only when quote exists) and break
  // createOrder, freezing both BUY and SELL flows right after TOP UP/SELL.
  useEffect(() => {
    if (stage !== 'quote') return;
    setQuote(null);
    if (!payInput || Number(payInput) <= 0) return;
    const id = setTimeout(() => { void fetchQuote(direction, asset, payInput); }, 600);
    return () => clearTimeout(id);
  }, [payInput, asset, direction, stage, fetchQuote]);

  useEffect(() => {
    if (!quote?.expiresAt || (stage !== 'quote' && stage !== 'bank' && stage !== 'confirm')) return;
    const tick = () => {
      const secs = Math.max(0, Math.floor((new Date(quote.expiresAt).getTime() - Date.now()) / 1000));
      setQuoteExpiry(secs);
      // Quote expired before confirmation: fetch a fresh quote, never order on a stale one.
      if (secs === 0 && (stage === 'quote' || stage === 'bank' || stage === 'confirm')) {
        void fetchQuote(direction, asset, payInput, true);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [quote?.expiresAt, stage, direction, asset, payInput, fetchQuote]);

  // ─── Direction flip (carries the counter value over) ───────────────────────
  const flip = useCallback(() => {
    setDirection((prev) => {
      const next = prev === 'BUY' ? 'SELL' : 'BUY';
      if (next === 'SELL' && quote) {
        setPayInput(String(quote.cryptoAmount));
      } else if (next === 'BUY' && quote) {
        const idr = quote.totalIdrPayout ?? quote.totalIdr ?? quote.idrAmount;
        setPayInput(String(Math.round(Number(idr))));
      } else {
        setPayInput('');
      }
      setQuote(null);
      setQuoteError(null);
      return next;
    });
  }, [quote]);

  const handleSelectAsset = (a: Asset) => {
    setAsset(a);
    setQuote(null);
    setQuoteError(null);
    if (NET[a].walletType === 'EVM') {
      void ensureChainForAsset(a).then((ok) => {
        if (!ok) toast.error('Wallet belum di jaringan yang benar.');
      });
    }
  };

  // ─── Continue → confirm/bank. Fetches the quote on demand if the
  // auto-fetch never delivered one, so the button always does something.
  const handleContinue = async () => {
    if (quoteLoading || quoteRefreshing) return;
    if (!payInput || Number(payInput) <= 0) {
      toast.error('Masukkan nominal terlebih dahulu.');
      return;
    }
    if (isBuy && Number(payInput) < limits.min) {
      toast.error(`Minimum order ${fmtIDR(limits.min)}.`);
      return;
    }
    if (!quote) {
      const fresh = await fetchQuote(direction, asset, payInput);
      if (!fresh) return; // error already surfaced inline + toast
    }
    const ecoLabel = meta.walletType === 'SOLANA' ? 'Solana' : 'EVM';
    // No selection yet: multiple wallets need an explicit choice (never guess).
    if (!selectedAddress) {
      if (assetSel.count > 1) {
        toast.error(`Pilih wallet ${ecoLabel} di WalletSidebar untuk melanjutkan.`);
      } else {
        toast.error('Hubungkan wallet terlebih dahulu.');
        if (meta.walletType === 'SOLANA') setShowConnectModal(true);
        else openEvmModal();
      }
      return;
    }
    // Selected wallet is not the live provider wallet: block, never silently switch.
    if (selectedMismatch) {
      toast.error(
        `Wallet ${selectedAddress.slice(0, 6)}…${selectedAddress.slice(-4)} belum aktif di wallet provider. Silakan ganti akun di wallet Anda untuk melanjutkan.`,
      );
      return;
    }
    if (!walletOk) {
      if (meta.walletType === 'EVM') {
        toast.error(`Switch ke ${info.network} untuk lanjut.`);
        void ensureChainForAsset(asset);
      } else {
        toast.error('Hubungkan Solana wallet (Phantom/Solflare).');
        setShowConnectModal(true);
      }
      return;
    }
    setStage(!isBuy ? 'bank' : 'confirm');
  };

  // ─── Create order (same contracts as the classic checkout) ─────────────────
  const createOrder = async () => {
    if (!quote || !resolvedAddress) return;
    if (!isBuy && (!bankName || !accountNumber || !accountName || accountNumber.length < 8)) {
      toast.error('Lengkapi data rekening bank');
      return;
    }
    setSubmitting(true);
    try {
      const url = isBuy ? '/api/orders/topup' : '/api/orders/sell';
      const body: Record<string, unknown> = {
        walletAddress: resolvedAddress,
        walletType: meta.walletType,
        quoteId: quote.quoteId,
        asset,
        network: meta.networkId,
      };
      if (!isBuy) {
        body.bankName = bankName;
        body.accountNumber = accountNumber;
        body.accountName = accountName;
      }
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error?.message ?? 'Gagal membuat order');
        return;
      }
      setOrder(data.order);
      if (data.payment) setPayment(data.payment);
      setDepositStatus('waiting');
      setCryptoConfirmed(false);
      setStage('processing');
    } catch {
      toast.error('Gagal terhubung ke server');
    } finally {
      setSubmitting(false);
    }
  };

  // (Sandbox simulation removed — Xendit test payments are driven from the
  // Xendit Dashboard in test mode, never from the browser.)

  // ─── BUY: payment-status poll → success ───────────────────────────────────
  // Xendit collects IDR; KORAMP delivers crypto via processCryptoDelivery.
  // payment-status converges PAYMENT_CONFIRMED, then check-delivery confirms
  // on-chain COMPLETED (ParticleBurst only after crypto confirmed).
  useEffect(() => {
    if (stage !== 'processing' || !isBuy || !order?.publicId) return;
    const publicId = order.publicId as string;
    let stop = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/orders/${publicId}/payment-status`);
        const data = await res.json();
        const status = data.status as string | undefined;
        if (!stop && (status === 'PAYMENT_CONFIRMED' || status === 'CRYPTO_PROCESSING' || status === 'COMPLETED')) {
          setOrder((prev: any) => ({ ...prev, status }));
          setStage('success');
        }
      } catch { /* silent: retry on next tick, never fail the transaction on one bad poll */ }
    };
    void poll();
    // 7s = ~8.5 req/min, di bawah limit payment-status 10/min.
    pollRef.current = setInterval(() => { void poll(); }, 7000);
    return () => {
      stop = true;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [stage, isBuy, order?.publicId]);

  useEffect(() => {
    if (stage !== 'success' || !isBuy || !order?.publicId || cryptoConfirmed) return;
    const check = async () => {
      try {
        const res = await fetch(`/api/orders/${order.publicId}/check-delivery`, { method: 'POST' });
        const data = await res.json();
        if (data.status === 'COMPLETED') {
          setCryptoConfirmed(true);
          if (data.txHash) setCryptoTxHash(data.txHash);
        }
      } catch { /* silent */ }
    };
    check();
    // 12s = 5 req/min, di bawah limit check-delivery 6/min.
    const id = setInterval(check, 12000);
    return () => clearInterval(id);
  }, [stage, isBuy, order?.publicId, cryptoConfirmed]);

  // ─── SELL: deposit poller + order status ───────────────────────────────────
  const pollDeposit = useCallback(async (publicId: string) => {
    try {
      const res = await fetch(`/api/orders/${publicId}/poll-deposit`, { method: 'POST' });
      const data = await res.json();
      if (data.requiredConfirmations) {
        setDepositConfs({ current: data.confirmations ?? 0, required: data.requiredConfirmations });
      }
      if (data.confirmed || data.status === 'CRYPTO_CONFIRMED') setDepositStatus('confirmed');
      else if (data.state === 'CONFIRMING' || data.status === 'CONFIRMING') setDepositStatus('confirming');
      else if (data.status === 'CRYPTO_DETECTED') setDepositStatus('detected');
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    if (stage !== 'processing' && stage !== 'success') return;
    if (isBuy || !order?.publicId || depositStatus === 'confirmed') return;
    const id = setInterval(() => { void pollDeposit(order.publicId); }, 8000);
    return () => clearInterval(id);
  }, [stage, isBuy, order?.publicId, depositStatus, pollDeposit]);

  const sellOrderStatus = (order as any)?.status as string | undefined;
  useEffect(() => {
    if (isBuy || !order?.publicId || (stage !== 'processing' && stage !== 'success')) return;
    // Terminal: stop polling once the order itself reports COMPLETED.
    if (sellOrderStatus === 'COMPLETED') return;
    const publicId = order.publicId as string;
    const check = async () => {
      try {
        const res = await fetch(`/api/orders/${publicId}`);
        const data = await res.json();
        if (['CRYPTO_CONFIRMED', 'PAYOUT_PROCESSING', 'PAYOUT_SENT', 'COMPLETED'].includes(data.status)) {
          setDepositStatus('confirmed');
          setOrder((prev: any) => ({ ...prev, ...data }));
          if (data.payout) setOrder((prev: any) => ({ ...prev, payout: data.payout }));
          if (data.status === 'COMPLETED') setStage('success');
        } else if (data.status === 'CRYPTO_DETECTED') setDepositStatus('detected');
        else if (data.status === 'CONFIRMING') setDepositStatus('confirming');
      } catch { /* silent: retry on next tick */ }
    };
    void check();
    const id = setInterval(() => { void check(); }, 5000);
    return () => clearInterval(id);
  }, [stage, isBuy, order?.publicId, sellOrderStatus]);

  const handleWalletSend = async () => {
    if (!order || sendingTx) return;
    setSendingTx(true);
    try {
      const hash = await sendCrypto({ to: order.depositAddress, amount: fmtC(order.cryptoAmount), asset });
      setTxHash(hash);
      toast.success('Transaksi dikirim! Memverifikasi ke blockchain...');
      try {
        await fetch(`/api/orders/${order.publicId}/submit-tx`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txHash: hash }),
        });
      } catch { /* poll-deposit fallback */ }
      await pollDeposit(order.publicId);
    } catch (err: any) {
      const msg = String(err?.message ?? '');
      toast.error(/reject|denied/i.test(msg) ? 'Transaksi dibatalkan oleh pengguna.' : `Gagal kirim: ${msg.slice(0, 80)}`);
    } finally {
      setSendingTx(false);
    }
  };

  const resetAll = () => {
    setStage('quote');
    setQuote(null);
    setQuoteError(null);
    setPayInput('');
    setOrder(null);
    setPayment(null);
    setTxHash(null);
    setDepositStatus('waiting');
    setDepositConfs(null);
    setCryptoConfirmed(false);
    setCryptoTxHash(null);
  };

  const payLabel = payIsIdr ? 'Indonesian Rupiah' : info.network;
  const receiveLabel = payIsIdr ? info.network : 'Indonesian Rupiah';

  return (
    <TerminalGrid
      open={chartOpen}
      chart={<TerminalChart symbol={asset ?? DEFAULT_CHART_ASSET} />}
      summary={
        <SummaryPanel
          variant={isBuy ? 'topup' : 'sell'}
          asset={asset}
          networkLabel={info.network}
          quote={quote}
          quoteExpiry={quoteExpiry}
          quoteRefreshing={quoteRefreshing}
        />
      }
    >
      <div className="space-y-4" data-swap-build="inline-v2">
        {/* Direction caption — swap button is the only direction control */}
        <div className="flex items-center justify-center min-h-[28px]" aria-live="polite">
          <AnimatePresence mode="wait">
            <motion.p
              key={direction + asset}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className={clsx(
                'text-xs font-semibold px-3 py-1.5 rounded-full border',
                isBuy
                  ? 'text-brand-400 border-brand-500/30 bg-brand-600/10'
                  : 'text-green-400 border-green-500/30 bg-green-600/10',
              )}
            >
              {isBuy ? `Top Up · IDR → ${asset}` : `Sell · ${asset} → IDR`}
            </motion.p>
          </AnimatePresence>
        </div>

        <AnimatePresence mode="wait">
          {stage === 'quote' && (
            <motion.div
              key={`quote-${direction}`}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -14 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              className="space-y-0"
            >
              {/* PAY card */}
              <div className="bg-surface-1 border border-line-subtle rounded-2xl p-4 sm:p-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-gray-500 text-xs font-semibold uppercase tracking-wider">You Pay</span>
                  {resolvedAddress ? (
                    <span className="text-gray-400 font-mono text-[11px]" title={`${meta.walletType} · ${info.network} — wallet terpilih untuk transaksi ini`}>
                      Wallet · {resolvedAddress.slice(0, 6)}...{resolvedAddress.slice(-4)}
                    </span>
                  ) : (
                    <span className="text-gray-600 text-[11px]">Wallet belum dipilih</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <div className="relative flex-1 min-w-0">
                    {payIsIdr && (
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-semibold">Rp</span>
                    )}
                    <input
                      type="number"
                      value={payInput}
                      onChange={(e) => setPayInput(e.target.value)}
                      onWheel={(e) => e.currentTarget.blur()}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') e.preventDefault();
                      }}
                      placeholder={payIsIdr ? '1.000.000' : '0.05'}
                      min={payIsIdr ? limits.min : 0}
                      max={payIsIdr ? limits.max : undefined}
                      step="any"
                      aria-label={payIsIdr ? 'Nominal IDR yang dibayar' : `Jumlah ${asset} yang dibayar`}
                      className={clsx(
                        'no-spin w-full bg-transparent text-2xl sm:text-3xl font-bold text-white placeholder-gray-700 focus:outline-none',
                        payIsIdr ? 'pl-10' : 'pr-16',
                      )}
                    />
                    {!payIsIdr && (
                      <span className={clsx('absolute right-1 top-1/2 -translate-y-1/2 font-bold text-sm', info.color)}>{asset}</span>
                    )}
                  </div>
                  {payIsIdr ? <IdrSelector open={fiatOpen} onOpenChange={setFiatOpen} /> : <TokenSelector value={asset} onChange={handleSelectAsset} open={selectorOpen} onOpenChange={setSelectorOpen} />}
                </div>
                <p className="text-gray-600 text-xs mt-2">{payLabel}</p>
              </div>

              <SwapDirectionButton direction={direction} onFlip={flip} disabled={quoteLoading} />

              {/* RECEIVE card */}
              <div className="bg-surface-1 border border-line-subtle rounded-2xl p-4 sm:p-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-gray-500 text-xs font-semibold uppercase tracking-wider">You Receive</span>
                  {quoteRefreshing && <span className="text-brand-400 text-xs">Memperbarui…</span>}
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <AnimatePresence mode="wait">
                      <motion.p
                        key={quote ? `${direction}-${payIsIdr ? quote.cryptoAmount : (quote.totalIdrPayout ?? quote.idrAmount)}` : 'empty'}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.18 }}
                        className="tnum text-2xl sm:text-3xl font-bold text-white truncate"
                      >
                        {quoteLoading ? '…' : quote ? (payIsIdr ? `${receiveCrypto} ${asset}` : receiveIdr) : '—'}
                      </motion.p>
                    </AnimatePresence>
                  </div>
                  {payIsIdr ? <TokenSelector value={asset} onChange={handleSelectAsset} open={selectorOpen} onOpenChange={setSelectorOpen} /> : <IdrSelector open={fiatOpen} onOpenChange={setFiatOpen} />}
                </div>
                <p className="text-gray-600 text-xs mt-2">{receiveLabel}</p>
                {quote && (
                  <p className="text-gray-500 text-xs mt-1.5">
                    Estimated rate: <span className="tnum text-gray-300">1 {asset} = {fmtIDR(quote.exchangeRate)}</span>
                  </p>
                )}
              </div>

              {/* Quote error — inline + retry */}
              {quoteError && !quote && !quoteLoading && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3 mt-4">
                  <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-red-300 text-sm">{quoteError}</p>
                    <button
                      onClick={() => { void fetchQuote(direction, asset, payInput); }}
                      className="mt-2 text-brand-400 text-xs font-semibold underline"
                    >
                      Coba lagi →
                    </button>
                  </div>
                </div>
              )}

              {/* Wallet hint (checkout guides connection too) */}
              {isConnected && !walletOk && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3 mt-4">
                  <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-red-400 text-sm">
                      {meta.walletType === 'SOLANA'
                        ? 'Hubungkan Solana wallet (Phantom/Solflare).'
                        : <>Terdeteksi <strong>{detectedEvmNetwork ?? 'network tak didukung'}</strong> — switch ke <strong>{info.network}</strong>.</>}
                    </p>
                    {meta.walletType === 'EVM' && (
                      <button
                        onClick={() => { void ensureChainForAsset(asset); }}
                        className="mt-2 w-full py-2 text-xs font-semibold rounded-lg border text-yellow-400 border-yellow-500/30 bg-yellow-500/10"
                      >
                        Switch ke {info.network} →
                      </button>
                    )}
                  </div>
                </div>
              )}
              {/* Selected ≠ live provider: explicit block, never silent switch */}
              {selectedMismatch && resolvedAddress && (
                <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-xl flex items-start gap-3 mt-4">
                  <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-yellow-300 text-sm">
                      Wallet {resolvedAddress.slice(0, 6)}…{resolvedAddress.slice(-4)} terpilih, tetapi belum aktif di wallet provider. Silakan ganti akun di wallet Anda untuk melanjutkan.
                    </p>
                  </div>
                </div>
              )}
              {(!isConnected || !resolvedAddress) && !selectedMismatch && (
                <button
                  onClick={() => (meta.walletType === 'SOLANA' ? setShowConnectModal(true) : openEvmModal())}
                  className="mt-4 w-full py-2.5 text-xs font-semibold rounded-xl border text-brand-400 border-brand-500/30 bg-brand-600/10"
                >
                  Hubungkan {meta.walletType === 'SOLANA' ? 'Solana' : 'EVM'} wallet untuk lanjut →
                </button>
              )}

              <button
                onClick={handleContinue}
                disabled={quoteLoading}
                className={clsx('btn-primary w-full mt-4 text-base', !isBuy && 'bg-green-600 hover:bg-green-500')}
              >
                {quoteLoading ? (
                  <><RefreshCw className="w-4 h-4 animate-spin inline mr-2" />Menghitung...</>
                ) : (
                  <>{isBuy ? 'Top Up' : 'Sell'} <ArrowRight className="w-4 h-4 inline ml-1" /></>
                )}
              </button>
              {!quote && !quoteLoading && Number(payInput) > 0 && (
                <button
                  onClick={() => { void fetchQuote(direction, asset, payInput); }}
                  className="btn-ghost w-full mt-2 text-sm text-center"
                >
                  Quote belum muncul? Muat ulang quote →
                </button>
              )}
              {quoteLoading && (
                <p className="text-center text-sm mt-2" role="status">
                  <ShimmerText>Mengambil harga pasar terbaru...</ShimmerText>
                </p>
              )}
            </motion.div>
          )}

          {stage === 'bank' && !isBuy && (
            <motion.div key="bank" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -14 }} transition={{ duration: 0.22 }} className="space-y-4">
              <button onClick={() => setStage('quote')} className="text-gray-500 hover:text-white text-sm">← Kembali</button>
              <p className="text-[#F5F5F5] font-semibold text-[15px]">Rekening penerima IDR</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {POPULAR_BANKS.map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setBankName(b)}
                    aria-pressed={bankName === b}
                    className={clsx('h-12 px-2 rounded-xl text-xs font-semibold border transition-all',
                      bankName === b ? 'bank-selected' : 'bank-idle bg-[#141416] border-[#232326] text-[#8B8B93]')}
                  >
                    {b}
                  </button>
                ))}
              </div>
              <div>
                <label className="label" htmlFor="swap-acct">Nomor rekening</label>
                <input id="swap-acct" inputMode="numeric" className="input-field font-mono text-sm" placeholder="Contoh: 1234567890"
                  value={accountNumber} onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, '').slice(0, 20))} />
                {accountNumber.length > 0 && accountNumber.length < 8 && (
                  <p className="text-[#EF4444] text-xs mt-1.5" role="alert">Nomor rekening minimal 8 digit.</p>
                )}
              </div>
              <div>
                <label className="label" htmlFor="swap-name">Nama pemilik rekening</label>
                <input id="swap-name" className="input-field text-sm" placeholder="Contoh: Budi Santoso"
                  value={accountName} onChange={(e) => setAccountName(e.target.value)} />
              </div>
              <button
                onClick={() => setStage('confirm')}
                disabled={!bankName || !accountNumber || !accountName || accountNumber.length < 8}
                className="btn-primary w-full bg-green-600 hover:bg-green-500"
              >
                Review & Konfirmasi →
              </button>
            </motion.div>
          )}

          {stage === 'confirm' && quote && (
            <motion.div key="confirm" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -14 }} transition={{ duration: 0.22 }} className="space-y-5">
              <button onClick={() => setStage(!isBuy ? 'bank' : 'quote')} className="text-gray-500 hover:text-white text-sm">← Kembali</button>
              <div className="bg-surface-1 border border-line-subtle rounded-2xl p-5 flex justify-between items-center">
                <span className="text-gray-400 text-sm">Anda bayar</span>
                <span className="tnum text-white font-bold text-lg">
                  {payIsIdr ? fmtIDR(payInput) : `${fmtC(payInput)} ${asset}`}
                </span>
              </div>
              <div className="p-4 bg-surface-1 border border-line-subtle rounded-xl">
                <p className="text-gray-500 text-xs mb-1">
                  {isBuy ? 'Crypto dikirim ke wallet Anda' : 'IDR dikirim ke rekening Anda'}
                </p>
                <p className="text-white font-mono text-sm break-all">
                  {isBuy ? resolvedAddress : `${bankName} · ****${accountNumber.slice(-4)} · ${accountName}`}
                </p>
              </div>
              <button
                onClick={createOrder}
                disabled={submitting || quoteRefreshing || quoteExpiry === 0}
                className={clsx('btn-primary w-full text-base py-3.5', !isBuy && 'bg-green-600 hover:bg-green-500')}
              >
                {submitting ? (
                  <><RefreshCw className="w-4 h-4 animate-spin inline mr-2" />Membuat order...</>
                ) : quoteExpiry === 0 ? (
                  'Memperbarui harga...'
                ) : isBuy ? (
                  <>Bayar {fmtIDR(quote.totalIdr)} →</>
                ) : (
                  <>Konfirmasi & Kirim Crypto →</>
                )}
              </button>
            </motion.div>
          )}

          {stage === 'processing' && order && (
            <motion.div key="processing" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -14 }} transition={{ duration: 0.22 }} className="space-y-5 max-w-lg mx-auto w-full">
              {isBuy && payment ? (
                <>
                  <div className="text-center">
                    <div className="w-14 h-14 bg-yellow-500/20 rounded-2xl flex items-center justify-center mx-auto mb-3">
                      <Clock className="w-7 h-7 text-yellow-400 animate-pulse" />
                    </div>
                    <h2 className="text-xl font-black text-white">Scan & Bayar QRIS</h2>
                    <p className="text-gray-400 text-sm mt-1">Scan dengan aplikasi e-wallet atau m-banking</p>
                  </div>
                  <div className="bg-surface-1 border border-line-subtle rounded-xl p-3">
                    <p className="text-gray-500 text-xs mb-2 text-center">Didukung oleh semua aplikasi QRIS</p>
                    <div className="flex flex-wrap justify-center gap-x-3 gap-y-1">
                      {['GoPay', 'OVO', 'ShopeePay', 'DANA', 'LinkAja', 'iSaku', 'Jenius', 'BCA', 'BRI', 'BNI', 'Mandiri', 'Bank lain'].map((app) => (
                        <span key={app} className="text-gray-400 text-xs">{app}</span>
                      ))}
                    </div>
                  </div>
                  <div className="flex justify-center">
                    <ToolChip state="running">Menunggu pembayaran...</ToolChip>
                  </div>
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
                        <p className="text-sm">QR belum tersedia</p>
                        <button type="button" className="text-xs text-brand-400 underline" onClick={() => setQrError(false)}>
                          Muat ulang QR
                        </button>
                      </div>
                    )}
                  </QrFrame>
                  <div className="bg-surface-1 border border-line-subtle rounded-xl p-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Total bayar</span>
                      <span className="text-white font-bold text-base">{fmtIDR(payment.grossAmount)}</span>
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
                  </div>
                  <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl flex items-start gap-2">
                    <Info className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                    <p className="text-blue-300 text-xs">Bayar <strong>tepat</strong> sesuai nominal di atas. Status diperbarui otomatis setelah konfirmasi. Jangan tutup halaman ini.</p>
                  </div>
                  {process.env.NODE_ENV !== 'production' && (
                    <p className="text-center text-[11px] text-gray-600">Sandbox: selesaikan pembayaran via Xendit Dashboard (test mode).</p>
                  )}
                </>
              ) : !isBuy ? (
                <>
                  <div className="bg-surface-1 border border-green-600/20 rounded-xl p-4 flex items-center justify-between">
                    <div>
                      <p className="text-gray-500 text-xs">Order</p>
                      <p className="text-white font-mono text-xs">{order.orderNumber}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-gray-500 text-xs">Kirim persis</p>
                      <p className={clsx('font-black text-lg', info.color)}>{fmtC(order.cryptoAmount)} {asset}</p>
                    </div>
                  </div>
                  <div className="p-4 bg-surface-1 border border-line-subtle rounded-xl space-y-3">
                    <div className="flex items-center justify-between p-3 bg-base rounded-lg border border-line-subtle">
                      <p className="text-white font-mono text-xs break-all flex-1">{order.depositAddress}</p>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(order.depositAddress);
                          setCopied(true);
                          toast.success('Alamat disalin!');
                          setTimeout(() => setCopied(false), 2000);
                        }}
                        className="ml-2 flex-shrink-0 p-2 rounded-lg hover:bg-white/5"
                        aria-label="Salin alamat deposit"
                      >
                        {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4 text-gray-400" />}
                      </button>
                    </div>
                  </div>
                  <button
                    onClick={handleWalletSend}
                    disabled={sendingTx}
                    className="w-full py-4 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 text-white font-bold rounded-2xl flex items-center justify-center gap-3 text-base transition-colors"
                  >
                    {sendingTx ? (
                      <><Loader2 className="w-5 h-5 animate-spin" /> Menunggu persetujuan wallet...</>
                    ) : (
                      <><Send className="w-5 h-5" /> Kirim {fmtC(order.cryptoAmount)} {asset}</>
                    )}
                  </button>
                  <div className="flex justify-center">
                    <ToolChip state={depositStatus === 'confirmed' ? 'done' : depositStatus === 'waiting' ? 'pending' : 'running'}>
                      {depositStatus === 'confirmed'
                        ? 'Crypto dikonfirmasi'
                        : depositStatus === 'detected'
                          ? 'Terdeteksi, menunggu konfirmasi'
                          : depositStatus === 'confirming'
                            ? `Mengonfirmasi${depositConfs ? ` ${depositConfs.current}/${depositConfs.required}` : '...'}`
                            : 'Menunggu pengiriman crypto'}
                    </ToolChip>
                  </div>
                  <button
                    onClick={() => { void pollDeposit(order.publicId); toast.success('Memindai blockchain...'); }}
                    className="w-full py-2.5 border border-line hover:border-line-strong text-gray-400 hover:text-white rounded-xl text-sm transition-colors"
                  >
                    Saya sudah mengirim, cek sekarang
                  </button>
                </>
              ) : null}
            </motion.div>
          )}

          {stage === 'success' && order && (
            <motion.div key="success" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }} className="relative text-center space-y-5 max-w-lg mx-auto w-full">
              {isBuy && cryptoConfirmed && <ParticleBurst />}
              <div className={clsx(
                'w-20 h-20 rounded-full flex items-center justify-center mx-auto',
                isBuy
                  ? (cryptoConfirmed ? 'bg-green-500/20' : 'bg-brand-600/20')
                  : (depositStatus === 'confirmed' ? 'bg-green-500/20' : 'bg-green-600/20'),
              )}>
                {isBuy && !cryptoConfirmed ? (
                  <RefreshCw className="w-10 h-10 text-brand-400 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-10 h-10 text-green-400" />
                )}
              </div>
              <div>
                <h2 className="text-2xl font-black text-white">
                  {isBuy
                    ? (cryptoConfirmed ? 'Crypto Terkirim! 🎉' : 'Pembayaran Dikonfirmasi!')
                    : (depositStatus === 'confirmed' ? 'Crypto Dikonfirmasi!' : 'Order Dibuat!')}
                </h2>
                <p className="text-gray-400 text-sm mt-2">
                  {isBuy
                    ? `${fmtC(order.cryptoAmount)} ${asset} ${cryptoConfirmed ? 'telah dikirim ke wallet Anda.' : 'sedang dikirim ke wallet Anda...'}`
                    : `${fmtC(order.cryptoAmount)} ${asset} terkonfirmasi. Payout IDR sedang diproses.`}
                </p>
              </div>
              <div className="bg-surface-1 border border-line-subtle rounded-xl p-5 text-left space-y-3">
                <div className="flex justify-between text-sm"><span className="text-gray-500">Order</span><span className="text-white font-mono text-xs">{order.orderNumber}</span></div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Jumlah</span>
                  {isBuy ? (
                    <AnimatedCounter value={parseFloat(order.cryptoAmount) || 0} format={(n) => `${fmtC(n)} ${asset}`} className="text-white font-bold" />
                  ) : (
                    <span className="text-green-400 font-bold">{fmtIDR(order.totalIdrPayout ?? order.idrAmount ?? 0)}</span>
                  )}
                </div>
                {(cryptoTxHash ?? order.cryptoTxHash ?? txHash) && (
                  <div className="flex justify-between text-sm items-center gap-2">
                    <span className="text-gray-500 flex-shrink-0">TX Hash</span>
                    <span className="text-brand-400 font-mono text-xs truncate">
                      {String(cryptoTxHash ?? order.cryptoTxHash ?? txHash).slice(0, 18)}…
                    </span>
                  </div>
                )}
                {!isBuy && depositStatus !== 'confirmed' && (
                  <div className="flex items-center gap-2 pt-1">
                    <RefreshCw className="w-3 h-3 text-green-400 animate-spin flex-shrink-0" />
                    <p className="text-green-400 text-xs">Menunggu konfirmasi blockchain (cek otomatis)</p>
                  </div>
                )}
                {isBuy && !cryptoConfirmed && (
                  <div className="flex items-center gap-2 pt-1">
                    <RefreshCw className="w-3 h-3 text-brand-400 animate-spin flex-shrink-0" />
                    <p className="text-brand-400 text-xs">Memverifikasi di blockchain (cek otomatis setiap 8 detik)</p>
                  </div>
                )}
              </div>
              <div className="flex gap-3">
                <button onClick={() => router.push(`/order/${order.publicId}`)} className="btn-secondary flex-1 text-sm">Lacak Order</button>
                <button onClick={resetAll} className="btn-primary flex-1 text-sm">Swap Lagi</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </TerminalGrid>
  );
}
