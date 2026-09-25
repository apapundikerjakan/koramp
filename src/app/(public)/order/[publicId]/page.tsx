'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Navbar } from '@/components/layout/Navbar';
import { CheckCircle2, RefreshCw, ExternalLink, AlertTriangle, ArrowLeft } from 'lucide-react';
import { TaskRow, CopyButton, StreamingText, ShimmerText } from '@/components/ui/motion';
import { TokenIcon } from '@/components/ui/TokenIcon';
import { getTxExplorerUrl } from '@/lib/assets';
import clsx from 'clsx';

const ASSET_COLOR: Record<string, string> = {
  SOL: 'text-purple-400', ETH: 'text-blue-400', BNB: 'text-yellow-400',
};
function buildExplorerUrl(network: string, txHash: string): string {
  // Canonical explorer URLs live in lib/assets (single source of truth).
  return getTxExplorerUrl(network as 'SOLANA' | 'BASE' | 'BSC', txHash);
}

function fmt(n: string | number) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(n));
}
function fmtC(n: string | number) {
  return parseFloat(Number(n).toFixed(8)).toString();
}
function shortAddr(s: string, chars = 8) {
  return s.length > chars * 2 + 3 ? `${s.slice(0, chars)}...${s.slice(-chars)}` : s;
}
function shortHash(s: string) {
  return s.length > 20 ? `${s.slice(0, 10)}...${s.slice(-8)}` : s;
}

// ── TOPUP STATUS STEPS ───────────────────────────────────────────────────────

const TOPUP_STEPS = [
  { key: 'CREATED', label: 'Order Dibuat' },
  { key: 'PAYMENT_PENDING', label: 'Menunggu Pembayaran' },
  { key: 'PAYMENT_CONFIRMED', label: 'Pembayaran Dikonfirmasi' },
  { key: 'CRYPTO_PROCESSING', label: 'Memproses Crypto' },
  { key: 'COMPLETED', label: 'Selesai' },
];

const SELL_STEPS = [
  { key: 'CREATED', label: 'Order Dibuat' },
  { key: 'AWAITING_CRYPTO', label: 'Menunggu Pengiriman Crypto' },
  { key: 'CRYPTO_DETECTED', label: 'Crypto Terdeteksi' },
  { key: 'CONFIRMING', label: 'Mengonfirmasi Blockchain' },
  { key: 'CRYPTO_CONFIRMED', label: 'Crypto Dikonfirmasi' },
  { key: 'PAYOUT_PROCESSING', label: 'Memproses Payout IDR' },
  { key: 'PAYOUT_SENT', label: 'Payout Dikirim' },
  { key: 'COMPLETED', label: 'Selesai' },
];

const FAILED_STATUSES = ['PAYMENT_FAILED', 'CRYPTO_FAILED', 'PAYOUT_FAILED', 'EXPIRED', 'CANCELLED', 'FAILED'];

function getStepIndex(steps: typeof TOPUP_STEPS, status: string): number {
  if (FAILED_STATUSES.includes(status)) return -1;
  const idx = steps.findIndex(s => s.key === status);
  return idx >= 0 ? idx : 0;
}

function StatusStep({ label, state }: { label: string; state: 'done' | 'active' | 'pending' }) {
  // TaskRow pattern (Beautiful UI): pending → running → done with row highlight.
  return <TaskRow label={label} state={state === 'active' ? 'running' : state} />;
}

export default function OrderStatusPage() {
  const params = useParams();
  const router = useRouter();
  const publicId = params.publicId as string;

  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [showManualTx, setShowManualTx] = useState(false);
  const [checkingDelivery, setCheckingDelivery] = useState(false);
  const [deliveryMsg, setDeliveryMsg] = useState<string | null>(null);

  const [manualTxHash, setManualTxHash] = useState('');
  const [manualTxLoading, setManualTxLoading] = useState(false);
  const orderPollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const orderPollBackoffRef = useRef<number>(5000);
  // Separate interval for CRYPTO_PROCESSING blockchain check-delivery.
  const deliveryPollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchOrder = useCallback(async () => {
    try {
      const res = await fetch(`/api/orders/${publicId}`);
      const data = await res.json();
      if (!res.ok) { setError(data.error?.message ?? 'Order tidak ditemukan'); return; }
      setOrder(data);
      setLastUpdated(new Date());
    } catch { setError('Gagal memuat order'); }
    finally { setLoading(false); }
  }, [publicId]);

  useEffect(() => {
    fetchOrder();
  }, [fetchOrder]);

  // Auto-poll for non-terminal statuses (backoff, stop on expiration/terminal).
  // Note: fetchOrder() is NOT called here on mount — the effect above handles initial load.
  const orderStatus = order?.status;
  useEffect(() => {
    if (!orderStatus) return;

    const terminalOrFailed = new Set([
      'COMPLETED', 'PAYMENT_FAILED', 'CRYPTO_FAILED', 'PAYOUT_FAILED', 'EXPIRED', 'CANCELLED', 'FAILED',
      'PAYMENT_CREATE_FAILED', 'PAYMENT_CREATE_UNKNOWN',
    ]);

    // Clear delivery interval whenever status changes.
    if (deliveryPollIntervalRef.current) {
      clearInterval(deliveryPollIntervalRef.current);
      deliveryPollIntervalRef.current = null;
    }

    if (terminalOrFailed.has(orderStatus)) {
      if (orderPollIntervalRef.current) {
        clearInterval(orderPollIntervalRef.current);
        orderPollIntervalRef.current = null;
      }
      return;
    }

    // DB status poll — every 5s for all non-terminal statuses.
    orderPollBackoffRef.current = 5000;
    if (orderPollIntervalRef.current) clearInterval(orderPollIntervalRef.current);
    orderPollIntervalRef.current = setInterval(fetchOrder, orderPollBackoffRef.current);

    // For CRYPTO_PROCESSING: also poll check-delivery every 12s to actively
    // probe the blockchain — avoids waiting for cron reconcile in development.
    // 12s = 5 req/min, di bawah limit 6/min (interval 8s = 7.5/min → 429).
    if (orderStatus === 'CRYPTO_PROCESSING') {
      const checkDelivery = async () => {
        try {
          const res = await fetch(`/api/orders/${publicId}/check-delivery`, { method: 'POST' });
          const data = await res.json();
          if (data.status === 'COMPLETED') {
            await fetchOrder(); // refresh DB state
          }
        } catch { /* silent — DB poll will catch it */ }
      };
      // Fire immediately, then every 8s.
      checkDelivery();
      deliveryPollIntervalRef.current = setInterval(checkDelivery, 12000);
    }

    return () => {
      if (orderPollIntervalRef.current) {
        clearInterval(orderPollIntervalRef.current);
        orderPollIntervalRef.current = null;
      }
      if (deliveryPollIntervalRef.current) {
        clearInterval(deliveryPollIntervalRef.current);
        deliveryPollIntervalRef.current = null;
      }
    };
  }, [fetchOrder, orderStatus, publicId]);

  // Copy feedback handled by CopyButton (Copy → Check, 2s reset).

  // Manual delivery check — for CRYPTO_PROCESSING orders.
  const checkDeliveryManual = useCallback(async () => {
    setCheckingDelivery(true);
    setDeliveryMsg(null);
    try {
      const res = await fetch(`/api/orders/${publicId}/check-delivery`, { method: 'POST' });
      const data = await res.json();
      if (data.status === 'COMPLETED') {
        setDeliveryMsg('✓ Crypto dikonfirmasi! Order selesai.');
        await fetchOrder();
      } else if (data.status === 'RATE_LIMITED') {
        setDeliveryMsg('Terlalu sering. Tunggu sebentar lalu coba lagi.');
      } else if (data.found === false) {
        setDeliveryMsg('Transaksi belum terindeks. Coba lagi dalam beberapa detik.');
      } else {
        const confs = data.confirmations ?? 0;
        setDeliveryMsg(`Menunggu konfirmasi blockchain… (${confs} konfirmasi diterima)`);
      }
    } catch {
      setDeliveryMsg('Gagal menghubungi server.');
    } finally {
      setCheckingDelivery(false);
    }
  }, [publicId, fetchOrder]);

  // Trigger blockchain scan langsung (halaman ini sendiri hanya membaca DB —
  // tanpa ini user bisa menunggu selamanya bila poll tab sell tertutup).
  const triggerScan = useCallback(async () => {
    setScanning(true);
    setScanMsg(null);
    try {
      const res = await fetch(`/api/orders/${publicId}/poll-deposit`, { method: 'POST' });
      const data = await res.json();
      if (data.confirmed) setScanMsg('Crypto dikonfirmasi! Payout diproses.');
      else if (data.found) setScanMsg(`Terdeteksi (${data.confirmations ?? 0}/${data.requiredConfirmations ?? '?'} konfirmasi).`);
      else if (data.reason === 'expired') setScanMsg('Order kedaluwarsa. Tempel TX hash manual di bawah.');
      else if (data.reason === 'rate_limited' || data.reason === 'throttled') setScanMsg('Terlalu sering. Tunggu sebentar lalu coba lagi.');
      else setScanMsg('Belum terdeteksi di blockchain. Pastikan TX sudah dikirim.');
      await fetchOrder();
    } catch {
      setScanMsg('Gagal menghubungi server.');
    } finally {
      setScanning(false);
    }
  }, [publicId, fetchOrder]);

  // Tempel TX hash manual — pemulihan bila auto-scan tidak menemukan TX.
  const submitManualTx = async () => {
    if (!manualTxHash.trim()) return;
    setManualTxLoading(true);
    try {
      const res = await fetch(`/api/orders/${publicId}/submit-tx`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txHash: manualTxHash.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.stored) {
        setShowManualTx(false);
        setManualTxHash('');
        await triggerScan();
      } else {
        setScanMsg(data.message ?? data.error?.message ?? 'TX tidak valid untuk order ini.');
      }
    } catch {
      setScanMsg('Gagal menghubungi server.');
    } finally {
      setManualTxLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-base">
        <Navbar />
        <div className="max-w-xl mx-auto px-4 sm:px-6 py-16 text-center">
          <RefreshCw className="w-8 h-8 text-brand-400 animate-spin mx-auto mb-3" />
          <p className="text-gray-400"><ShimmerText>Memuat status order...</ShimmerText></p>
        </div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="min-h-screen bg-base">
        <Navbar />
        <div className="max-w-xl mx-auto px-4 sm:px-6 py-16 text-center">
          <AlertTriangle className="w-10 h-10 text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-black text-white mb-2">Order tidak ditemukan</h2>
          <p className="text-gray-500 text-sm mb-6">{error ?? 'Periksa kembali ID order Anda.'}</p>
          <button onClick={() => router.push('/')} className="btn-secondary text-sm">← Kembali ke beranda</button>
        </div>
      </div>
    );
  }

  const isTopUp = order.type === 'TOP_UP';
  const steps = isTopUp ? TOPUP_STEPS : SELL_STEPS;
  const currentIdx = getStepIndex(steps, order.status);
  const isFailed = FAILED_STATUSES.includes(order.status);
  const isCompleted = order.status === 'COMPLETED';
  const assetColor = ASSET_COLOR[order.asset] ?? 'text-gray-300';
  const explorerUrl = order.cryptoTxHash && order.network
    ? buildExplorerUrl(order.network, order.cryptoTxHash)
    : null;

  return (
    <div className="min-h-screen bg-base">
      <Navbar />
      <div className="max-w-xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        {/* Back */}
        <button onClick={() => router.push('/')} className="flex items-center gap-2 text-gray-500 hover:text-white text-sm mb-6 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Beranda
        </button>

        {/* Order header */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <TokenIcon symbol={order.asset} size={26} />
              <h1 className="text-xl font-black text-white">
                {isTopUp ? 'Top Up' : 'Sell'} {order.asset}
              </h1>
            </div>
            <p className="text-gray-500 text-xs font-mono">{order.orderNumber}</p>
          </div>
          <div className="text-right">
            <div className={clsx('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border',
              isCompleted ? 'bg-green-500/10 border-green-500/30 text-green-400' :
              isFailed ? 'bg-red-500/10 border-red-500/30 text-red-400' :
              'bg-brand-600/10 border-brand-600/30 text-brand-400'
            )}>
              {!isCompleted && !isFailed && <span className="w-1.5 h-1.5 bg-brand-400 rounded-full animate-pulse" />}
              {isCompleted && <CheckCircle2 className="w-3 h-3" />}
              {isFailed && <AlertTriangle className="w-3 h-3" />}
              {order.status.replace(/_/g, ' ')}
            </div>
            <p className="text-gray-600 text-xs mt-1.5">
              Update: {lastUpdated.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </p>
          </div>
        </div>

        {/* Status timeline */}
        <div className="bg-surface-1 border border-line-subtle rounded-2xl p-5 mb-5">
          <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-4">Status Transaksi</p>
          {isFailed ? (
            <div className="flex items-start gap-3 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
              <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-red-400 font-semibold text-sm">Transaksi Gagal</p>
                {order.failureReason && <p className="text-gray-400 text-xs mt-1">{order.failureReason}</p>}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {steps.map((s, i) => {
                // COMPLETED = semua step done (termasuk "Selesai"), bukan active/spinner.
                let state: 'done' | 'active' | 'pending' = 'pending';
                if (isCompleted) state = 'done';
                else if (i < currentIdx) state = 'done';
                else if (i === currentIdx) state = 'active';
                return <StatusStep key={s.key} label={s.label} state={state} />;
              })}
            </div>
          )}
        </div>

        {/* Order details */}
        <div className="bg-surface-1 border border-line-subtle rounded-2xl p-5 mb-5 space-y-3">
          <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-1">Detail Order</p>

          {[
            ['Tipe', isTopUp ? 'Top Up (IDR → Crypto)' : 'Sell (Crypto → IDR)'],
            ['Asset', <span key="asset-val" className={assetColor}>{order.asset} / {order.network}</span>],
            isTopUp
              ? ['Nominal IDR', fmt(order.idrAmount)]
              : ['Crypto dijual', `${fmtC(order.cryptoAmount)} ${order.asset}`],
            isTopUp
              ? ['Crypto diterima', <span key="crypto-val" className={clsx('font-bold', assetColor)}>≈ {fmtC(order.cryptoAmount)} {order.asset}</span>]
              : ['IDR diterima', <span key="idr-val" className="text-green-400 font-bold">{fmt(order.totalIdrPayout)}</span>],
            ['Biaya layanan', fmt(order.serviceFee)],
            ['Tax', fmt(order.tax ?? 0)],
            ['Biaya jaringan', fmt(order.networkFee)],
          ].map(([label, val]: any) => (
            <div key={String(label)} className="flex justify-between items-center text-sm">
              <span className="text-gray-500">{label}</span>
              <span className="text-gray-200">{val}</span>
            </div>
          ))}

          <div className="border-t border-line-subtle pt-3">
            <p className="text-gray-500 text-xs mb-1">Wallet</p>
            <div className="flex items-center gap-2">
              <p className="text-gray-300 font-mono text-xs flex-1">{shortAddr(order.walletAddress, 10)}</p>
              <CopyButton text={order.walletAddress} label="Salin alamat wallet" />
            </div>
          </div>

          <div className="flex justify-between text-xs text-gray-600">
            <span>Dibuat: {new Date(order.createdAt).toLocaleString('id-ID')}</span>
            {order.completedAt && <span>Selesai: {new Date(order.completedAt).toLocaleString('id-ID')}</span>}
          </div>
        </div>

        {/* TOPUP: Payment info */}
        {isTopUp && order.payment && (
          <div className="bg-surface-1 border border-line-subtle rounded-2xl p-5 mb-5">
            <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">Pembayaran</p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Status</span>
                <span className={clsx('font-semibold', order.payment.status === 'PAID' ? 'text-green-400' : order.payment.status === 'EXPIRED' ? 'text-red-400' : 'text-yellow-400')}>
                  {order.payment.status}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Nominal (QRIS)</span>
                <span className="text-white font-bold">{fmt(order.payment.grossAmount)}</span>
              </div>
              {order.payment.provider && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Provider</span>
                  <span className="text-gray-300 capitalize">{order.payment.provider}</span>
                </div>
              )}
              {order.payment.paidAt && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Dibayar</span>
                  <span className="text-gray-300 text-xs">{new Date(order.payment.paidAt).toLocaleString('id-ID')}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* SELL: Deposit address */}
        {!isTopUp && order.status === 'AWAITING_CRYPTO' && (
          <div className="bg-surface-1 border border-yellow-500/20 rounded-2xl p-5 mb-5">
            <p className="text-yellow-400 text-xs font-semibold uppercase tracking-wider mb-3">Alamat Deposit</p>
            <p className="text-gray-500 text-xs mb-2">Kirim <strong className="text-white">{fmtC(order.cryptoAmount)} {order.asset}</strong> ke alamat berikut:</p>
            <div className="bg-base border border-line-subtle rounded-xl p-3 flex items-center gap-3 mb-2">
              <p className="font-mono text-xs text-white flex-1 break-all">{order.depositAddress}</p>
              <CopyButton text={order.depositAddress} label="Salin alamat deposit" />
            </div>
            <p className="text-red-400 text-xs">⚠ Hanya kirim {order.asset} di jaringan {order.network}.</p>

            {/* Scan langsung — halaman tracking hanya membaca DB, jadi sediakan pemicu */}
            <button onClick={triggerScan} disabled={scanning}
              className="mt-3 w-full py-2.5 bg-brand-600 hover:bg-brand-500 disabled:bg-gray-600 text-white rounded-xl text-sm font-semibold transition-colors">
              {scanning ? 'Memindai blockchain...' : 'Cek blockchain sekarang'}
            </button>
            {scanMsg && <p className="text-gray-300 text-xs mt-2">{scanMsg}</p>}

            {!showManualTx ? (
              <button onClick={() => setShowManualTx(true)}
                className="w-full text-gray-600 hover:text-gray-300 text-xs mt-2 transition-colors">
                Sudah kirim tapi tak terdeteksi? Tempel TX hash manual →
              </button>
            ) : (
              <div className="mt-2 p-3 bg-base border border-line-subtle rounded-xl space-y-2">
                <p className="text-gray-400 text-xs">Tempel TX hash dari wallet/explorer. Server memverifikasi penerima, pengirim & nominal.</p>
                <div className="flex items-center gap-2">
                  <input
                    value={manualTxHash}
                    onChange={e => setManualTxHash(e.target.value.trim())}
                    placeholder="0x..."
                    spellCheck="false" autoComplete="off"
                    className="flex-1 min-w-0 px-3 py-2 bg-base border border-line-subtle rounded-lg text-white font-mono text-xs placeholder-gray-600 focus:outline-none focus:border-brand-500/50"
                  />
                  <button onClick={submitManualTx} disabled={manualTxLoading || (() => {
                      // SOL: base58 signature 87–88 chars; EVM: 0x + 64 hex = 66 chars
                      const n = manualTxHash.length;
                      return order.network === 'SOLANA' ? (n < 87 || n > 88) : n !== 66;
                    })()}
                    className="flex-shrink-0 px-3 py-2 bg-brand-600 hover:bg-brand-500 disabled:bg-gray-600 text-white rounded-lg text-xs font-semibold transition-colors">
                    {manualTxLoading ? '...' : 'Cek'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* SELL: Deposit confirmations */}
        {!isTopUp && order.deposit && order.deposit.confirmations > 0 && (
          <div className="bg-surface-1 border border-line-subtle rounded-2xl p-5 mb-5">
            <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">Konfirmasi Blockchain</p>
            <div className="flex items-center gap-3">
              <div className="flex-1 bg-base rounded-full h-2">
                <div className="bg-brand-500 h-2 rounded-full transition-all"
                  style={{ width: `${order.requiredConfirmations > 0 ? Math.min(100, (order.deposit.confirmations / order.requiredConfirmations) * 100) : 0}%` }} />
              </div>
              <span className="text-brand-400 text-sm font-bold">
                {order.deposit.confirmations}/{order.requiredConfirmations ?? '?'}
              </span>
            </div>
          </div>
        )}

        {/* TOPUP: CRYPTO_PROCESSING — blockchain confirmation checker */}
        {isTopUp && order.status === 'CRYPTO_PROCESSING' && (
          <div className="bg-surface-1 border border-brand-600/30 rounded-2xl p-5 mb-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 bg-brand-600/20 rounded-xl flex items-center justify-center">
                <RefreshCw className="w-4 h-4 text-brand-400 animate-spin" />
              </div>
              <div>
                <p className="text-white font-semibold text-sm">Memproses Pengiriman Crypto</p>
                <p className="text-gray-400 text-xs"><StreamingText text="Menunggu konfirmasi blockchain. Cek otomatis setiap 8 detik." /></p>
              </div>
            </div>
            <button
              onClick={checkDeliveryManual}
              disabled={checkingDelivery}
              className="w-full py-2.5 bg-brand-600 hover:bg-brand-500 disabled:bg-gray-700 text-white rounded-xl text-sm font-semibold transition-colors"
            >
              {checkingDelivery ? <><RefreshCw className="w-3.5 h-3.5 animate-spin inline mr-2" />Memeriksa...</> : 'Cek Konfirmasi Sekarang'}
            </button>
            {deliveryMsg && (
              <p className={clsx('text-xs mt-2 text-center', deliveryMsg.startsWith('✓') ? 'text-green-400' : 'text-gray-400')}>
                {deliveryMsg}
              </p>
            )}
          </div>
        )}

        {/* Tx hash */}
        {order.cryptoTxHash && (
          <div className="bg-surface-1 border border-line-subtle rounded-xl p-4 mb-5">
            <p className="text-gray-500 text-xs mb-2">Transaction Hash</p>
            <div className="flex items-center gap-3">
              <p className="text-gray-300 font-mono text-xs flex-1">{shortHash(order.cryptoTxHash)}</p>
              <CopyButton text={order.cryptoTxHash} label="Salin TX hash" />
              {explorerUrl && (
                <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="text-brand-400 hover:text-brand-300">
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          </div>
        )}

        {/* SELL: Payout info */}
        {!isTopUp && order.payout && (
          <div className="bg-surface-1 border border-line-subtle rounded-2xl p-5 mb-5">
            <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">Payout IDR</p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Status</span>
                <span className={clsx('font-semibold', order.payout.status === 'COMPLETED' ? 'text-green-400' : 'text-yellow-400')}>{order.payout.status}</span>
              </div>
              {order.payout.completedAt && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Selesai</span>
                  <span className="text-gray-300 text-xs">{new Date(order.payout.completedAt).toLocaleString('id-ID')}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Refresh button for non-terminal */}
        {!isCompleted && !isFailed && (
          <div className="flex items-center gap-2 justify-center">
            <button onClick={fetchOrder} className="flex items-center gap-2 text-gray-500 hover:text-white text-sm py-2 px-4 rounded-lg hover:bg-white/5 transition-all">
              <RefreshCw className="w-3.5 h-3.5" /> Refresh manual
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
