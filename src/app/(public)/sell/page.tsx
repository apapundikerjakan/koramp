'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/layout/Navbar';
import { useWallet } from '@/contexts/WalletContext';
import {
  ArrowRight, AlertTriangle, Clock, CheckCircle2, RefreshCw,
  Copy, AlertCircle, Loader2, Send, QrCode, Wallet, Check,
  ArrowDownToLine, Banknote,
} from 'lucide-react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { buildPaymentUri } from '@/lib/paymentQr';
import { CHAIN_NAMES } from '@/lib/assets';
import { SummaryPanel } from '@/components/order/SummaryPanel';
import { TerminalGrid, ChartPanelSkeleton, ChartToggleButton, useChartToggle } from '@/components/order/TerminalLayout';
import { DEFAULT_CHART_ASSET } from '@/lib/tradingView';
import { TokenIcon } from '@/components/ui/TokenIcon';
import {
  StepIndicator, ToolChip,
  AnimatedCounter, ParticleBurst, ShimmerText,
} from '@/components/ui/motion';

// ─── Types ────────────────────────────────────────────────────────────────────

type Asset = 'SOL' | 'ETH' | 'BNB';
type Step = 'asset' | 'amount' | 'bank' | 'confirm' | 'sending' | 'waiting' | 'success';
type DepositStatus = 'waiting' | 'detected' | 'confirming' | 'confirmed';
type InputMode = 'idr' | 'crypto'; // what the user types

// ─── Constants ────────────────────────────────────────────────────────────────

const ASSET_INFO = {
  SOL: { color: 'text-purple-400', border: 'border-purple-500/30', bg: 'bg-purple-500/10', network: 'Solana Network', networkId: 'SOLANA', walletType: 'SOLANA' },
  ETH: { color: 'text-blue-400',   border: 'border-blue-500/30',   bg: 'bg-blue-500/10',   network: 'Base Sepolia',   networkId: 'BASE',   walletType: 'EVM'    },
  BNB: { color: 'text-yellow-400', border: 'border-yellow-500/30', bg: 'bg-yellow-500/10', network: 'BSC Testnet', networkId: 'BSC',  walletType: 'EVM'    },
} as const;

const POPULAR_BANKS = ['BCA', 'BRI', 'BNI', 'Mandiri', 'CIMB Niaga', 'BSI', 'Permata', 'BTN'];
const STEPS: Step[] = ['asset', 'amount', 'bank', 'confirm', 'sending', 'waiting'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: string | number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(n));
}
function fmtC(n: string | number) { return parseFloat(Number(n).toFixed(8)).toString(); }

// Trading-terminal chart — client-only (TradingView embed needs window/document).
const TerminalChart = dynamic(
  () => import('@/components/ui/TradingViewAdvancedChart').then((m) => ({ default: m.TradingViewTerminalChart })),
  { ssr: false, loading: () => <ChartPanelSkeleton /> },
);

// ─── QR Code component ───────────────────────────────────────────────────────
// Self-hosted canvas renderer — no financial data sent to third parties.
// qrcode generates the QR entirely in-browser (canvas → data URL).

function PaymentQrCode({ uri }: { uri: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!uri || !canvasRef.current) return;
    import('qrcode').then((QRCode) => {
      if (!canvasRef.current) return;
      QRCode.toCanvas(canvasRef.current, uri, {
        width: 200,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      }).catch(() => {/* render error handled by canvas staying blank */});
    }).catch(() => {/* module load error — canvas stays blank */});
  }, [uri]);

  return (
    <div className="p-3 bg-white rounded-xl inline-block shadow-lg">
      <canvas ref={canvasRef} width={200} height={200} />
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SellPage() {
  const router = useRouter();
  const {
    evmAddress, evmChainId, solAddress, address, isConnected, setShowConnectModal, openEvmModal,
    isCorrectNetworkForAsset, ensureChainForAsset, sendCrypto, walletName,
  } = useWallet();

  // ── Core state ───────────────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>('asset');
  const [asset, setAsset] = useState<Asset | null>(null);
  const [inputMode, setInputMode] = useState<InputMode>('idr'); // IDR or crypto input
  const [amountInput, setAmountInput] = useState('');           // raw user input
  const [quote, setQuote] = useState<any>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteExpiry, setQuoteExpiry] = useState(0);
  const [quoteRefreshing, setQuoteRefreshing] = useState(false);

  // Trading-terminal chart (left column) — preference persisted, mobile defaults closed.
  const { chartOpen, toggleChart } = useChartToggle();
  const isChartStep = step === 'asset' || step === 'amount' || step === 'bank' || step === 'confirm';
  const [order, setOrder] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

  // ── Bank form ─────────────────────────────────────────────────────────────
  const [bankName, setBankName] = useState('');
  const [bankNameCustom, setBankNameCustom] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [showCustomBank, setShowCustomBank] = useState(false);

  // ── Send & deposit state ─────────────────────────────────────────────────
  const [sendMethod, setSendMethod] = useState<'wallet' | 'qr'>('wallet');
  const [sendingTx, setSendingTx] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txState, setTxState] = useState<'idle' | 'submitted' | 'detected' | 'confirming' | 'confirmed'>('idle');
  const [txConfs, setTxConfs] = useState<{ current: number; required: number } | null>(null);
  const [showManualTx, setShowManualTx] = useState(false);
  const [manualTxHash, setManualTxHash] = useState('');
  const [manualTxLoading, setManualTxLoading] = useState(false);
  const [depositStatus, setDepositStatus] = useState<DepositStatus>('waiting');
  const [depositConfs, setDepositConfs] = useState<{ current: number; required: number } | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);

  // ── Payout / success state ────────────────────────────────────────────────
  const [payout, setPayout] = useState<any>(null);
  const [payoutWaitSecs, setPayoutWaitSecs] = useState(0);
  const payoutTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Derived ───────────────────────────────────────────────────────────────
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
  // Resolve correct address per asset ecosystem
  const resolvedAddress = asset
    ? (ASSET_INFO[asset].walletType === 'SOLANA' ? solAddress : evmAddress)
    : address;
  const resolvedWalletType = asset ? ASSET_INFO[asset].walletType : null;
  const stepIdx = STEPS.indexOf(step);
  const paymentUri = order
    ? buildPaymentUri({
        depositAddress: order.depositAddress,
        amount: fmtC(order.cryptoAmount),
        asset: asset ?? 'SOL',
        orderNumber: order.orderNumber,
        label: 'Kipramp',
      })
    : '';

  // ─── Quote auto-refresh ────────────────────────────────────────────────────
  const refreshingRef = useRef(false);
  const autoRefreshQuote = useCallback(async () => {
    if (!asset || !amountInput || !['bank', 'confirm'].includes(step)) return;
    if (refreshingRef.current) return; // guard against overlapping refreshes
    refreshingRef.current = true;
    setQuoteRefreshing(true);
    try {
      const body = inputMode === 'idr'
        ? { asset, network: ASSET_INFO[asset].networkId, idrAmount: amountInput }
        : { asset, network: ASSET_INFO[asset].networkId, cryptoAmount: amountInput };
      const res = await fetch('/api/quotes/sell', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) setQuote(data.quote);
    } catch { /* silent */ }
    finally { setQuoteRefreshing(false); refreshingRef.current = false; }
  }, [asset, amountInput, step, inputMode]);

  useEffect(() => {
    if (!quote?.expiresAt) return;
    const tick = () => {
      const secs = Math.max(0, Math.floor((new Date(quote.expiresAt).getTime() - Date.now()) / 1000));
      setQuoteExpiry(secs);
      if (secs === 0 && ['bank', 'confirm'].includes(step)) autoRefreshQuote();
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [quote?.expiresAt, step, autoRefreshQuote]);

  // ─── Blockchain deposit poller ─────────────────────────────────────────────
  // DB ringan tiap poll; tracking hash berat ditangani backend (submit-tx).
  const pollDeposit = useCallback(async (publicId: string, silent = false) => {
    try {
      const res = await fetch(`/api/orders/${publicId}/poll-deposit`, { method: 'POST' });
      const data = await res.json();
      if (data.requiredConfirmations) {
        setDepositConfs({ current: data.confirmations ?? 0, required: data.requiredConfirmations });
        setTxConfs({ current: data.confirmations ?? 0, required: data.requiredConfirmations });
      }
      if (data.confirmed || data.status === 'CRYPTO_CONFIRMED') {
        setDepositStatus('confirmed');
        setTxState('confirmed');
        setPollError(null);
      } else if (data.state === 'CONFIRMING' || data.status === 'CONFIRMING') {
        setDepositStatus('confirming');
        setTxState('confirming');
        setPollError(null);
      } else if (data.status === 'CRYPTO_DETECTED') {
        setDepositStatus('detected');
        setTxState('detected');
        setPollError(null);
      } else if (!silent && data.found === false) {
        setPollError('Transaksi belum terdeteksi. Pastikan sudah dikirim ke alamat yang benar.');
      }
    } catch { /* silent */ }
  }, []);

  // Order DB status poll — every 5s while in sending/waiting
  useEffect(() => {
    if (!['sending', 'waiting'].includes(step) || !order?.publicId) return;
    const check = async () => {
      try {
        const res = await fetch(`/api/orders/${order.publicId}`);
        const data = await res.json();
        if (['CRYPTO_CONFIRMED', 'PAYOUT_PROCESSING', 'PAYOUT_SENT', 'COMPLETED'].includes(data.status)) {
          setDepositStatus('confirmed');
          setOrder((prev: any) => ({ ...prev, ...data }));
          if (data.status === 'PAYOUT_PROCESSING' || data.status === 'PAYOUT_SENT') {
            setStep('waiting');
          }
          if (data.status === 'COMPLETED') {
            // Fetch payout proof then go to success
            const pr = await fetch(`/api/orders/${order.publicId}/payout-status`);
            const pd = await pr.json();
            setPayout(pd.payout);
            setStep('success');
          }
        } else if (data.status === 'CRYPTO_DETECTED') {
          setDepositStatus('detected');
        } else if (data.status === 'CONFIRMING') {
          setDepositStatus('confirming');
          if (data.confirmations && data.requiredConfirmations) {
            setDepositConfs({ current: data.confirmations, required: data.requiredConfirmations });
          }
        }
      } catch {}
    };
    check();
    const id = setInterval(check, 5000);
    return () => clearInterval(id);
  }, [step, order?.publicId]);

  // Blockchain scanner — every 8s
  useEffect(() => {
    if (!['sending', 'waiting'].includes(step) || !order?.publicId || depositStatus === 'confirmed') return;
    const id = setInterval(() => pollDeposit(order.publicId, true), 8000);
    return () => clearInterval(id);
  }, [step, order?.publicId, depositStatus, pollDeposit]);

  // Payout waiting timer
  useEffect(() => {
    if (step !== 'waiting') return;
    setPayoutWaitSecs(0);
    payoutTimerRef.current = setInterval(() => {
      setPayoutWaitSecs(s => s + 1);
    }, 1000);
    return () => { if (payoutTimerRef.current) clearInterval(payoutTimerRef.current); };
  }, [step]);

  // ─── Actions ───────────────────────────────────────────────────────────────

  const getQuote = async () => {
    if (!asset || !amountInput) return;
    setQuoteLoading(true);
    try {
      const body = inputMode === 'idr'
        ? { asset, network: ASSET_INFO[asset].networkId, idrAmount: amountInput }
        : { asset, network: ASSET_INFO[asset].networkId, cryptoAmount: amountInput };
      const res = await fetch('/api/quotes/sell', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error?.message ?? 'Gagal mendapatkan quote'); return; }
      setQuote(data.quote);
      setStep('bank');
    } catch { toast.error('Gagal terhubung ke server'); }
    finally { setQuoteLoading(false); }
  };

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
    const finalBank = showCustomBank ? bankNameCustom : bankName;
    if (!finalBank || !accountNumber || !accountName) { toast.error('Lengkapi data rekening bank'); return; }
    setSubmitting(true);
    try {
      const res = await fetch('/api/orders/sell', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: resolvedAddress, walletType: resolvedWalletType,
          quoteId: quote.quoteId, asset,
          network: ASSET_INFO[asset].networkId,
          bankName: finalBank, accountNumber, accountName,
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error?.message ?? 'Gagal membuat order'); return; }
      setOrder(data.order);
      setStep('sending');
    } catch { toast.error('Gagal terhubung ke server'); }
    finally { setSubmitting(false); }
  };

  // Send via wallet (opens wallet popup)
  // PRIMARY FLOW (§2/§3): hash yang dikembalikan wallet LANGSUNG disubmit
  // ke backend untuk dilacak — bukan dicari ulang via block scan.
  const handleWalletSend = async () => {
    if (!order || !asset) return;
    setSendingTx(true);
    try {
      const hash = await sendCrypto({
        to: order.depositAddress,
        amount: fmtC(order.cryptoAmount),
        asset,
      });
      setTxHash(hash);
      setTxState('submitted');
      toast.success('Transaksi dikirim! Memverifikasi ke blockchain...');

      try {
        const res = await fetch(`/api/orders/${order.publicId}/submit-tx`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ txHash: hash }),
        });
        const data = await res.json();
        if (res.ok && data.stored) {
          if (data.requiredConfirmations) {
            setTxConfs({ current: data.confirmations ?? 0, required: data.requiredConfirmations });
            setDepositConfs({ current: data.confirmations ?? 0, required: data.requiredConfirmations });
          }
          if (data.state === 'CONFIRMED') {
            setTxState('confirmed');
            setDepositStatus('confirmed');
          } else if (data.state === 'CONFIRMING') {
            setTxState('confirming');
            setDepositStatus('confirming');
          } else {
            setTxState(data.state === 'PENDING' ? 'submitted' : 'detected');
            if (data.state !== 'PENDING') setDepositStatus('detected');
          }
        } else if (data.reason === 'tx_failed') {
          toast.error('Transaksi GAGAL di blockchain. Dana tidak terkirim — periksa wallet lalu coba lagi.');
          setTxState('idle');
          return;
        }
        // Selain itu (pending/indexing/RPC sesaat): lanjut — poll-deposit
        // sebagai jaring pengaman akan mengejar hash yang sama.
      } catch {
        // Gagal hubungi submit (jaringan) — poll-deposit sebagai fallback.
      }

      // Trigger immediate scan
      await pollDeposit(order.publicId, false);
      setStep('waiting');
    } catch (err: any) {
      const msg = err?.message ?? '';
      if (msg.toLowerCase().includes('reject') || msg.toLowerCase().includes('denied')) {
        toast.error('Transaksi dibatalkan oleh pengguna.');
      } else {
        toast.error(`Gagal kirim: ${msg.slice(0, 80)}`);
      }
    } finally {
      setSendingTx(false);
    }
  };

  // Manual "already sent" trigger scan
  const handleAlreadySent = async () => {
    if (!order?.publicId) return;
    setPollError(null);
    await pollDeposit(order.publicId, false);
    toast.success('Memindai blockchain...');
    setStep('waiting');
  };

  // Manual TX hash submit — pemulihan bila auto-scan tidak menemukan TX
  // (mis. TX sudah lebih tua dari window scan). Server verifikasi penerima,
  // pengirim & nominal langsung ke blockchain sebelum menyimpan.
  const handleManualTxSubmit = async () => {
    if (!order?.publicId || !manualTxHash.trim()) return;
    setManualTxLoading(true);
    try {
      const res = await fetch(`/api/orders/${order.publicId}/submit-tx`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txHash: manualTxHash.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.stored) {
        setTxHash(data.txHash);
        toast.success('TX terverifikasi! Mengecek konfirmasi...');
        setShowManualTx(false);
        setManualTxHash('');
        await pollDeposit(order.publicId, false);
        setStep('waiting');
      } else {
        toast.error(data.message ?? data.error?.message ?? 'TX tidak valid untuk order ini.');
      }
    } catch {
      toast.error('Gagal terhubung ke server');
    } finally {
      setManualTxLoading(false);
    }
  };

  const copyAddress = () => {
    if (!order?.depositAddress) return;
    navigator.clipboard.writeText(order.depositAddress);
    setCopied(true);
    toast.success('Alamat disalin!');
    setTimeout(() => setCopied(false), 2000);
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-base">
      <Navbar />
      <div className="mx-auto w-full max-w-[1600px] px-4 py-6">

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between gap-3 mb-1">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-green-600/20 rounded-xl flex items-center justify-center">
                <ArrowDownToLine className="w-5 h-5 text-green-400" />
              </div>
              <h1 className="text-2xl font-black text-white">Sell Crypto</h1>
            </div>
            {isChartStep && <ChartToggleButton open={chartOpen} onToggle={toggleChart} />}
          </div>
          <p className="text-gray-500 text-sm pl-12">Crypto → IDR. Terima pembayaran ke rekening bank.</p>
        </div>

        {/* Step indicator */}
        {!['success'].includes(step) && (
          <StepIndicator
            steps={[
              { key: 'asset', label: 'Aset' },
              { key: 'amount', label: 'Nominal' },
              { key: 'bank', label: 'Bank' },
              { key: 'confirm', label: 'Konfirmasi' },
              { key: 'sending', label: 'Kirim' },
              { key: 'waiting', label: 'Tunggu' },
            ]}
            current={stepIdx}
            accent="bg-green-600"
          />
        )}

        {/* ── ASSET ───────────────────────────────────────────────────────── */}
        {step === 'asset' && (
          <TerminalGrid open={chartOpen} chart={<TerminalChart symbol={asset ?? DEFAULT_CHART_ASSET} />} summary={<SummaryPanel variant="sell" asset={asset} networkLabel={info?.network} quote={null} />}>
          <div className="space-y-4">
            <p className="text-gray-400 text-sm font-semibold">Pilih crypto yang ingin dijual</p>
            <div className="space-y-3">
              {(['SOL', 'ETH', 'BNB'] as Asset[]).map(a => {
                const ai = ASSET_INFO[a];
                const glow = a === 'SOL' ? 'glow-sol' : a === 'ETH' ? 'glow-eth' : 'glow-bnb';
                return (
                  <button key={a} onClick={() => handleSelectAsset(a)} type="button"
                    aria-pressed={asset === a}
                    className={clsx('w-full flex items-center gap-4 p-4 rounded-2xl border-2 text-left asset-lift',
                      glow,
                      asset === a ? 'selected border-green-500 bg-green-600/10 glass' : 'border-line-subtle hover:bg-surface-2',
                    )}>
                    <div className={clsx('w-12 h-12 rounded-xl border flex items-center justify-center', ai.bg, ai.border)}><TokenIcon symbol={a} size={26} /></div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className={clsx('font-bold', ai.color)}>{a}</span>
                        {asset === a && <CheckCircle2 className="w-4 h-4 text-green-400" />}
                      </div>
                      <p className="text-gray-400 text-sm">{ai.network}</p>
                    </div>
                  </button>
                );
              })}
            </div>
            {asset && !isConnected && (
              <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-xl">
                <p className="text-yellow-400 text-sm font-semibold">Wallet belum terhubung</p>
                <button onClick={() => info?.walletType === 'SOLANA' ? setShowConnectModal(true) : openEvmModal()} className="mt-1 text-brand-400 text-xs underline">Hubungkan wallet →</button>
              </div>
            )}
            {asset && isConnected && !walletOk && (
              <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
                <p className="text-red-400 text-sm">
                  {info?.walletType === 'SOLANA'
                    ? 'Hubungkan Solana wallet (Phantom/Solflare).'
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
            )}
            <button className="btn-primary w-full bg-green-600 hover:bg-green-500"
              disabled={!asset || !isConnected || !walletOk}
              onClick={() => setStep('amount')}>
              Lanjut <ArrowRight className="w-4 h-4 inline ml-1" />
            </button>
          </div>
          </TerminalGrid>
        )}

        {/* ── AMOUNT ──────────────────────────────────────────────────────── */}
        {step === 'amount' && asset && (
          <TerminalGrid open={chartOpen} chart={<TerminalChart symbol={asset ?? DEFAULT_CHART_ASSET} />} summary={<SummaryPanel variant="sell" asset={asset} networkLabel={info?.network} quote={null} />}>
          <div className="space-y-5">
            <button onClick={() => setStep('asset')} className="text-gray-500 hover:text-white text-sm">← Kembali</button>

            {/* Input mode toggle */}
            <div className="flex rounded-xl overflow-hidden border border-line-subtle">
              <button
                onClick={() => { setInputMode('idr'); setAmountInput(''); }}
                className={clsx('flex-1 py-2.5 text-sm font-semibold transition-colors',
                  inputMode === 'idr' ? 'bg-green-600/20 text-green-400' : 'text-gray-500 hover:text-gray-300',
                )}>
                Input IDR (payout)
              </button>
              <button
                onClick={() => { setInputMode('crypto'); setAmountInput(''); }}
                className={clsx('flex-1 py-2.5 text-sm font-semibold transition-colors',
                  inputMode === 'crypto' ? 'bg-green-600/20 text-green-400' : 'text-gray-500 hover:text-gray-300',
                )}>
                Input {asset}
              </button>
            </div>

            <div>
              {inputMode === 'idr' ? (
                <>
                  <label className="label">IDR yang ingin diterima</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-semibold">Rp</span>
                    <input type="number" className="input-field pl-10 text-lg font-semibold"
                      placeholder="50000" value={amountInput}
                      onChange={e => setAmountInput(e.target.value)} min="50000" step="10000" />
                  </div>
                  <p className="text-gray-500 text-xs mt-1.5">
                    Anda akan mengirim lebih banyak {asset} — biaya dipotong dari crypto yang dikirim
                  </p>
                  <div className="grid grid-cols-4 gap-2 mt-3">
                    {['100000', '250000', '500000', '1000000'].map(v => (
                      <button key={v} onClick={() => setAmountInput(v)}
                        className={clsx('py-2 rounded-lg text-xs font-semibold border transition-all',
                          amountInput === v ? 'bg-green-600/20 border-green-500 text-green-400' : 'bg-surface-1 border-line-subtle text-gray-400 hover:border-line-strong',
                        )}>
                        {parseInt(v).toLocaleString('id-ID').replace(/\./g, '').slice(0, 3)}rb
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <label className="label">Jumlah {asset} yang dijual</label>
                  <div className="relative">
                    <input type="number" className="input-field pr-20 text-lg font-semibold"
                      placeholder="0.1" value={amountInput}
                      onChange={e => setAmountInput(e.target.value)} step="0.001" min="0.001" />
                    <span className={clsx('absolute right-4 top-1/2 -translate-y-1/2 font-black text-sm', info?.color)}>{asset}</span>
                  </div>
                  <p className="text-gray-500 text-xs mt-1.5">IDR yang diterima sudah dipotong biaya platform</p>
                </>
              )}
            </div>

            <button className="btn-primary w-full bg-green-600 hover:bg-green-500"
              disabled={!amountInput || quoteLoading}
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

        {/* ── BANK ────────────────────────────────────────────────────────── */}
        {step === 'bank' && quote && asset && (
          <TerminalGrid open={chartOpen} chart={<TerminalChart symbol={asset ?? DEFAULT_CHART_ASSET} />} summary={<SummaryPanel variant="sell" asset={asset} networkLabel={info?.network} quote={quote} quoteExpiry={quoteExpiry} quoteRefreshing={quoteRefreshing} />}>
          <div className="space-y-5">
            <button onClick={() => setStep('amount')} className="text-gray-500 hover:text-white text-sm">← Kembali</button>

            {/* Bank form */}
            <div className="space-y-4">
              <p className="text-white font-semibold text-sm">Rekening penerima IDR</p>
              <div>
                <label className="label">Nama bank</label>
                <div className="grid grid-cols-4 gap-2 mb-2">
                  {POPULAR_BANKS.map(b => (
                    <button key={b} type="button" onClick={() => { setBankName(b); setShowCustomBank(false); }}
                      className={clsx('py-2 px-1 rounded-lg text-xs font-semibold border transition-all',
                        bankName === b && !showCustomBank ? 'bg-green-600/20 border-green-500 text-green-400' : 'bg-surface-1 border-line-subtle text-gray-400 hover:border-line-strong',
                      )}>{b}</button>
                  ))}
                </div>
                <button type="button" onClick={() => { setShowCustomBank(true); setBankName(''); }}
                  className={clsx('w-full py-2 text-xs rounded-lg border transition-all',
                    showCustomBank ? 'bg-green-600/20 border-green-500 text-green-400' : 'border-line-subtle text-gray-500 hover:border-line-strong',
                  )}>
                  + Bank lainnya
                </button>
                {showCustomBank && <input className="input-field mt-2 text-sm" placeholder="Nama bank..." value={bankNameCustom} onChange={e => setBankNameCustom(e.target.value)} />}
              </div>
              <div>
                <label className="label">Nomor rekening</label>
                <input className="input-field font-mono text-sm" placeholder="0123456789"
                  value={accountNumber} onChange={e => setAccountNumber(e.target.value.replace(/\D/g, ''))} />
              </div>
              <div>
                <label className="label">Nama pemilik rekening</label>
                <input className="input-field text-sm" placeholder="Sesuai buku tabungan"
                  value={accountName} onChange={e => setAccountName(e.target.value)} />
              </div>
              <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-xl flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
                <p className="text-yellow-300 text-xs">Pastikan data rekening benar. IDR ditransfer setelah crypto dikonfirmasi. Data ini hanya untuk transaksi ini.</p>
              </div>
            </div>

            <button className="btn-primary w-full bg-green-600 hover:bg-green-500"
              disabled={(!bankName && !bankNameCustom) || !accountNumber || !accountName}
              onClick={() => setStep('confirm')}>
              Review & Konfirmasi →
            </button>
          </div>
          </TerminalGrid>
        )}

        {/* ── CONFIRM ─────────────────────────────────────────────────────── */}
        {step === 'confirm' && quote && asset && (
          <TerminalGrid open={chartOpen} chart={<TerminalChart symbol={asset ?? DEFAULT_CHART_ASSET} />} summary={<SummaryPanel variant="sell" asset={asset} networkLabel={info?.network} quote={quote} quoteExpiry={quoteExpiry} quoteRefreshing={quoteRefreshing} />}>
          <div className="space-y-5">
            <button onClick={() => setStep('bank')} className="text-gray-500 hover:text-white text-sm">← Kembali</button>

            <div className="bg-surface-1 border border-line-subtle rounded-xl p-4 space-y-1.5 text-sm">
              <p className="text-gray-400 font-semibold mb-2">Rekening Tujuan IDR</p>
              <div className="flex justify-between"><span className="text-gray-500">Bank</span><span className="text-white">{showCustomBank ? bankNameCustom : bankName}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">No. Rekening</span><span className="text-white font-mono">{accountNumber}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Nama</span><span className="text-white">{accountName}</span></div>
            </div>

            {/* Quote countdown tampil di panel Ringkasan di bawah —
                tidak diduplikasi di sini. */}

            <button className="btn-primary w-full bg-green-600 hover:bg-green-500 text-base py-3.5"
              disabled={submitting || quoteRefreshing} onClick={createOrder}>
              {submitting ? <><RefreshCw className="w-4 h-4 animate-spin inline mr-2" />Membuat order...</> : 'Konfirmasi & Kirim Crypto →'}
            </button>
          </div>
          </TerminalGrid>
        )}

        {/* ── SENDING ─────────────────────────────────────────────────────── */}
        {step === 'sending' && order && asset && (
          <div className="space-y-5 animate-fade-in max-w-lg mx-auto w-full">

            {/* Order summary bar */}
            <div className="bg-surface-1 border border-green-600/20 rounded-xl p-4 flex items-center justify-between">
              <div>
                <p className="text-gray-500 text-xs">Order</p>
                <p className="text-white font-mono text-xs">{order.orderNumber}</p>
              </div>
              <div className="text-right">
                <p className="text-gray-500 text-xs">Kirim persis</p>
                <p className={clsx('font-black text-lg', info?.color)}>{fmtC(order.cryptoAmount)} {asset}</p>
              </div>
            </div>

            {/* Send method tabs */}
            <div className="flex rounded-xl overflow-hidden border border-line-subtle">
              <button onClick={() => setSendMethod('wallet')}
                className={clsx('flex-1 flex items-center justify-center gap-2 py-3 text-sm font-semibold transition-colors',
                  sendMethod === 'wallet' ? 'bg-green-600/20 text-green-400' : 'text-gray-500 hover:text-gray-300',
                )}>
                <Wallet className="w-4 h-4" /> Kirim via Wallet
              </button>
              <button onClick={() => setSendMethod('qr')}
                className={clsx('flex-1 flex items-center justify-center gap-2 py-3 text-sm font-semibold transition-colors',
                  sendMethod === 'qr' ? 'bg-green-600/20 text-green-400' : 'text-gray-500 hover:text-gray-300',
                )}>
                <QrCode className="w-4 h-4" /> Scan QR
              </button>
            </div>

            {/* ── Wallet send panel ── */}
            {sendMethod === 'wallet' && (
              <div className="space-y-4">
                <div className="p-4 bg-surface-1 border border-line-subtle rounded-xl space-y-3">
                  <p className="text-gray-400 text-sm">Klik tombol di bawah untuk membuka {walletName ?? 'wallet'} dan mengirim:</p>
                  <div className="flex items-center justify-between p-3 bg-base rounded-lg border border-line-subtle">
                    <div>
                      <p className="text-gray-500 text-xs">Ke alamat</p>
                      <p className="text-white font-mono text-xs break-all">{order.depositAddress}</p>
                    </div>
                    <button onClick={copyAddress} className="ml-2 flex-shrink-0 p-2 rounded-lg hover:bg-white/5">
                      {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4 text-gray-400" />}
                    </button>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-base rounded-lg border border-line-subtle">
                    <p className="text-gray-500 text-xs">Jumlah</p>
                    <p className={clsx('font-black', info?.color)}>{fmtC(order.cryptoAmount)} {asset}</p>
                  </div>
                </div>

                <button
                  onClick={handleWalletSend}
                  disabled={sendingTx}
                  className="w-full py-4 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 text-white font-bold rounded-2xl flex items-center justify-center gap-3 text-base transition-colors"
                >
                  {sendingTx
                    ? <><Loader2 className="w-5 h-5 animate-spin" /> Menunggu persetujuan wallet...</>
                    : <><Send className="w-5 h-5" /> Kirim {fmtC(order.cryptoAmount)} {asset}</>
                  }
                </button>

                {/* Status pelacakan hash — update otomatis tanpa tempel manual */}
                {txState !== 'idle' && (
                  <div className="p-3 bg-surface-1 border border-line-subtle rounded-xl text-center">
                    {txState === 'submitted' && (
                      <p className="text-blue-400 text-sm">Transaksi dikirim — memverifikasi hash ke blockchain...</p>
                    )}
                    {txState === 'detected' && (
                      <p className="text-yellow-400 text-sm">TX terdeteksi — menunggu konfirmasi blockchain...</p>
                    )}
                    {txState === 'confirming' && (
                      <p className="text-yellow-400 text-sm">
                        Mengonfirmasi blockchain{txConfs ? ` ${txConfs.current}/${txConfs.required}` : '...'}
                      </p>
                    )}
                    {txState === 'confirmed' && (
                      <p className="text-green-400 text-sm">Crypto dikonfirmasi! Payout diproses.</p>
                    )}
                    {txHash && (
                      <p className="text-gray-600 font-mono text-xs mt-1 break-all">{txHash.slice(0, 18)}...{txHash.slice(-8)}</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── QR Code panel ── */}
            {sendMethod === 'qr' && (
              <div className="space-y-4">
                <div className="flex flex-col items-center gap-3">
                  <p className="text-gray-400 text-sm text-center">Scan dengan {asset === 'SOL' ? 'Phantom / Solflare' : 'MetaMask Mobile'} atau wallet yang mendukung {asset === 'SOL' ? 'Solana Pay' : 'EIP-681'}</p>
                  <PaymentQrCode uri={paymentUri} />
                  <div className="text-center">
                    <p className={clsx('font-black text-2xl', info?.color)}>{fmtC(order.cryptoAmount)} {asset}</p>
                    <p className="text-gray-500 text-xs mt-1">ke {order.depositAddress.slice(0, 8)}...{order.depositAddress.slice(-6)}</p>
                  </div>
                </div>

                {/* Manual copy fallback */}
                <div className="bg-surface-1 border border-line-subtle rounded-xl p-3">
                  <p className="text-gray-500 text-xs mb-2">Atau salin alamat manual:</p>
                  <div className="flex items-center gap-2">
                    <p className="text-white font-mono text-xs flex-1 break-all">{order.depositAddress}</p>
                    <button onClick={copyAddress} className="flex-shrink-0 p-2 rounded-lg hover:bg-white/5">
                      {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4 text-gray-400" />}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Already sent button */}
            <button onClick={handleAlreadySent}
              className="w-full py-2.5 border border-line hover:border-line-strong text-gray-400 hover:text-white rounded-xl text-sm transition-colors">
              Saya sudah mengirim — cek sekarang
            </button>

            {/* Manual TX hash — KHUSUS kiriman dari wallet lain (§20).
                Alur normal (kirim via tombol di atas) otomatis submit hash. */}
            {!showManualTx ? (
              <button onClick={() => setShowManualTx(true)}
                className="w-full text-gray-600 hover:text-gray-300 text-xs transition-colors">
                Sudah kirim dari wallet lain? Tempel TX hash →
              </button>
            ) : (
              <div className="p-3 bg-surface-1 border border-line-subtle rounded-xl space-y-2">
                <p className="text-gray-400 text-xs">
                  Tempel TX hash dari wallet/explorer (0x...). Server memverifikasi penerima, pengirim & nominal.
                </p>
                <div className="flex items-center gap-2">
                  <input
                    value={manualTxHash}
                    onChange={e => setManualTxHash(e.target.value.trim())}
                    placeholder="0x..."
                    spellCheck="false" autoComplete="off"
                    className="flex-1 min-w-0 px-3 py-2 bg-base border border-line-subtle rounded-lg text-white font-mono text-xs placeholder-gray-600 focus:outline-none focus:border-green-500/50"
                  />
                  <button onClick={handleManualTxSubmit} disabled={manualTxLoading || (() => {
                      // SOL: base58 signature 87–88 chars; EVM: 0x + 64 hex = 66 chars
                      const n = manualTxHash.length;
                      return order?.network === 'SOLANA' ? (n < 87 || n > 88) : n !== 66;
                    })()}
                    className="flex-shrink-0 px-3 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 text-white rounded-lg text-xs font-semibold transition-colors">
                    {manualTxLoading ? '...' : 'Cek'}
                  </button>
                </div>
              </div>
            )}

            <p className="text-gray-600 text-xs text-center">
              Kipramp memverifikasi transaksi secara independen di blockchain.
            </p>
          </div>
        )}

        {/* ── WAITING (payout processing) ──────────────────────────────────── */}
        {step === 'waiting' && order && (
          <div className="space-y-5 animate-fade-in max-w-lg mx-auto w-full">

            {/* Crypto confirmed banner */}
            {depositStatus === 'confirmed' ? (
              <div className="flex items-center gap-3 p-4 bg-green-500/10 border border-green-500/20 rounded-xl">
                <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0" />
                <div>
                  <p className="text-green-400 font-semibold text-sm">Crypto dikonfirmasi!</p>
                  <p className="text-gray-400 text-xs">Payout IDR sedang diproses ke rekening Anda</p>
                </div>
              </div>
            ) : depositStatus === 'detected' ? (
              <div className="flex items-center gap-3 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-xl">
                <Loader2 className="w-4 h-4 text-yellow-400 animate-spin flex-shrink-0" />
                <div>
                  <p className="text-yellow-400 font-semibold text-sm">Transaksi terdeteksi</p>
                  {depositConfs && <p className="text-gray-400 text-xs">{depositConfs.current}/{depositConfs.required} konfirmasi</p>}
                </div>
              </div>
            ) : depositStatus === 'confirming' ? (
              <div className="flex items-center gap-3 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-xl">
                <Loader2 className="w-4 h-4 text-yellow-400 animate-spin flex-shrink-0" />
                <div>
                  <p className="text-yellow-400 font-semibold text-sm">Mengonfirmasi blockchain</p>
                  {depositConfs && <p className="text-gray-400 text-xs">{depositConfs.current}/{depositConfs.required} konfirmasi</p>}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl">
                <RefreshCw className="w-4 h-4 text-blue-400 animate-spin flex-shrink-0" />
                <div>
                  <p className="text-blue-400 font-semibold text-sm">Memindai blockchain...</p>
                  <p className="text-gray-400 text-xs">Scan otomatis setiap 8 detik</p>
                </div>
              </div>
            )}

            {/* Deposit status chip (Beautiful UI tool chip) */}
            <div className="flex justify-center">
              <ToolChip
                state={depositStatus === 'confirmed' ? 'done' : depositStatus === 'waiting' ? 'pending' : 'running'}
              >
                {depositStatus === 'confirmed'
                  ? 'Crypto dikonfirmasi'
                  : depositStatus === 'detected'
                    ? 'Terdeteksi — menunggu konfirmasi'
                    : depositStatus === 'confirming'
                      ? `Mengonfirmasi blockchain${depositConfs ? ` ${depositConfs.current}/${depositConfs.required}` : '...'}`
                      : 'Menunggu pengiriman crypto'}
              </ToolChip>
            </div>

            {/* Payout status */}
            <div className="bg-surface-1 border border-line-subtle rounded-2xl p-5 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-green-500/20 rounded-xl flex items-center justify-center">
                  <Banknote className="w-5 h-5 text-green-400" />
                </div>
                <div>
                  <p className="text-white font-bold text-sm">Payout IDR</p>
                  <AnimatedCounter
                    value={parseFloat(order.totalIdrPayout) || 0}
                    format={(n) => fmt(n)}
                    className="text-green-400 font-black text-lg"
                  />
                </div>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Bank</span><span className="text-white">{order.payoutBankName}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Rekening</span><span className="text-white font-mono">****{order.payoutAccountNumber?.slice(-4)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Nama</span><span className="text-white">{order.payoutAccountName}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Order</span><span className="text-white font-mono text-xs">{order.orderNumber}</span></div>
              </div>

              {/* Waiting timer */}
              {depositStatus === 'confirmed' && (
                <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-xl flex items-center gap-2">
                  <Clock className="w-4 h-4 text-yellow-400" />
                  <p className="text-yellow-300 text-xs">
                    Menunggu transfer payout... ({Math.floor(payoutWaitSecs / 60)}m {payoutWaitSecs % 60}s)
                  </p>
                </div>
              )}
            </div>

            {txHash && (
              <div className="bg-surface-1 border border-line-subtle rounded-xl p-3">
                <p className="text-gray-500 text-xs mb-1">Transaction Hash</p>
                <p className="text-white font-mono text-xs break-all">{txHash}</p>
              </div>
            )}

            <button onClick={() => router.push(`/order/${order.publicId}`)}
              className="btn-ghost w-full text-sm">
              Lihat status order →
            </button>
          </div>
        )}

        {/* ── SUCCESS ─────────────────────────────────────────────────────── */}
        {step === 'success' && order && (
          <div className="relative space-y-5 animate-fade-in max-w-lg mx-auto w-full">
            <ParticleBurst />
            <div className="text-center">
              <div className="w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-10 h-10 text-green-400" />
              </div>
              <h2 className="text-2xl font-black text-white">Transaksi Berhasil!</h2>
              <p className="text-gray-400 text-sm mt-2">IDR telah dikirim ke rekening Anda</p>
            </div>

            {/* Receipt */}
            <div className="bg-surface-1 border border-green-600/20 rounded-2xl p-5 space-y-3">
              <p className="text-white font-bold text-sm border-b border-line-subtle pb-2">Bukti Transaksi</p>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Order</span><span className="text-white font-mono text-xs">{order.orderNumber}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Crypto dijual</span><span className={clsx('font-bold', info?.color)}>{fmtC(order.cryptoAmount)} {asset}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">IDR diterima</span><span className="text-green-400 font-black text-base">{fmt(order.totalIdrPayout)}</span></div>
              </div>

              {payout && (
                <>
                  <div className="border-t border-line-subtle pt-3 space-y-2 text-sm">
                    <p className="text-gray-400 font-semibold text-xs uppercase tracking-wider">Detail Transfer Bank</p>
                    <div className="flex justify-between"><span className="text-gray-500">Bank</span><span className="text-white">{payout.bankName}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">No. Rekening</span><span className="text-white font-mono">{payout.accountNumber}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Nama</span><span className="text-white">{payout.accountName}</span></div>
                    {payout.providerRef && (
                      <div className="flex justify-between"><span className="text-gray-500">Ref. Transfer</span><span className="text-white font-mono text-xs">{payout.providerRef}</span></div>
                    )}
                    {payout.completedAt && (
                      <div className="flex justify-between"><span className="text-gray-500">Waktu</span><span className="text-white text-xs">{new Date(payout.completedAt).toLocaleString('id-ID')}</span></div>
                    )}
                  </div>
                </>
              )}

              {txHash && (
                <div className="border-t border-line-subtle pt-3">
                  <p className="text-gray-500 text-xs mb-1">Crypto TX Hash</p>
                  <p className="text-white font-mono text-xs break-all">{txHash}</p>
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <button onClick={() => router.push(`/order/${order.publicId}`)}
                className="btn-secondary flex-1 text-sm">Lihat Order</button>
              <button onClick={() => {
                setStep('asset'); setAsset(null); setQuote(null); setOrder(null);
                setAmountInput(''); setBankName(''); setAccountNumber(''); setAccountName('');
                setTxHash(null); setDepositStatus('waiting'); setPayout(null);
                setTxState('idle'); setTxConfs(null); setDepositConfs(null);
                setShowManualTx(false); setManualTxHash(''); setPollError(null);
                setQuoteExpiry(0); setSendMethod('wallet'); setBankNameCustom('');
                setShowCustomBank(false); setInputMode('idr');
              }} className="btn-primary flex-1 text-sm bg-green-600 hover:bg-green-500">
                Sell Lagi
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
