import Link from 'next/link';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { HeroCta, BottomCta } from '@/components/home/HomeCta';
import { Zap, Shield, Eye, ChevronRight, ArrowUpRight, ArrowDownLeft } from 'lucide-react';

// Server Component (P24) — wallet interactivity isolated in HomeCta islands.
// This keeps homepage JS minimal and lets Next statically optimize it.

const ASSETS = [
  { symbol: 'SOL', name: 'Solana', network: 'Solana Network', icon: '◎', color: 'text-purple-400', border: 'border-purple-500/20', bg: 'bg-purple-500/8' },
  { symbol: 'ETH', name: 'Ethereum', network: 'Base Network', icon: 'Ξ', color: 'text-blue-400', border: 'border-blue-500/20', bg: 'bg-blue-500/8' },
  { symbol: 'BNB', name: 'BNB', network: 'BNB Smart Chain', icon: '⬡', color: 'text-yellow-400', border: 'border-yellow-500/20', bg: 'bg-yellow-500/8' },
];

const HOW_TOPUP = ['Hubungkan wallet', 'Pilih crypto (SOL/ETH/BNB)', 'Masukkan nominal IDR', 'Dapatkan quote instan', 'Bayar via QRIS', 'Crypto masuk ke wallet'];
const HOW_SELL = ['Hubungkan wallet', 'Pilih crypto yang dijual', 'Masukkan jumlah', 'Dapatkan quote IDR', 'Kirim ke alamat deposit', 'Terima IDR ke rekening bank'];

const FEATURES = [
  { icon: Zap, title: 'Tanpa Daftar Akun', desc: 'Cukup hubungkan wallet. Tidak perlu email, password, atau registrasi.', color: 'text-brand-400', bg: 'bg-brand-500/10' },
  { icon: Eye, title: 'Harga Transparan', desc: 'Lihat rate, biaya layanan, dan total yang diterima sebelum konfirmasi.', color: 'text-green-400', bg: 'bg-green-500/10' },
  { icon: Shield, title: 'Aman & Terverifikasi', desc: 'Pembayaran diverifikasi server-side. Private key tidak pernah diminta.', color: 'text-purple-400', bg: 'bg-purple-500/10' },
];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#07071a]">
      <Navbar />

      {/* ── HERO ─────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        {/* Background glow */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-brand-600/10 rounded-full blur-3xl" />
          <div className="absolute top-20 right-1/4 w-64 h-64 bg-purple-600/8 rounded-full blur-3xl" />
        </div>

        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-24 text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-brand-600/10 border border-brand-600/20 text-brand-400 text-sm font-medium mb-8">
            <span className="w-1.5 h-1.5 bg-brand-400 rounded-full animate-pulse" />
            Crypto On/Off-Ramp · Tanpa Daftar Akun
          </div>

          {/* Headline */}
          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-black text-white tracking-tight leading-[1.05] mb-6">
            Top Up Crypto &{' '}
            <span className="bg-gradient-to-r from-brand-400 via-purple-400 to-blue-400 bg-clip-text text-transparent">
              Sell Crypto
            </span>
            <br />dengan IDR
          </h1>

          <p className="text-gray-400 text-lg sm:text-xl max-w-2xl mx-auto leading-relaxed mb-10">
            Beli SOL, ETH, BNB menggunakan Rupiah.<br />
            Jual crypto dan terima IDR ke rekening bank.<br />
            <span className="text-gray-500 text-base">Cukup hubungkan wallet — tidak perlu daftar akun.</span>
          </p>

          {/* CTA Buttons (client island) */}
          <HeroCta />
        </div>
      </section>

      {/* ── SUPPORTED ASSETS ─────────────────────────────────────── */}
      <section className="py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto">
          <p className="text-center text-gray-600 text-xs font-semibold uppercase tracking-widest mb-6">
            Aset yang Didukung
          </p>
          <div className="grid grid-cols-3 gap-4">
            {ASSETS.map(a => (
              <div key={a.symbol} className={`rounded-2xl border ${a.border} ${a.bg} p-5 text-center`}>
                <div className={`text-4xl font-black mb-2 ${a.color}`}>{a.icon}</div>
                <div className={`font-bold text-xl ${a.color}`}>{a.symbol}</div>
                <div className="text-gray-500 text-xs mt-1.5 leading-tight">{a.network}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURES ─────────────────────────────────────────────── */}
      <section className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {FEATURES.map(f => (
              <div key={f.title} className="bg-[#0b0b1f] border border-[#1a1a3e] rounded-2xl p-6">
                <div className={`w-11 h-11 ${f.bg} rounded-xl flex items-center justify-center mb-4`}>
                  <f.icon className={`w-5 h-5 ${f.color}`} />
                </div>
                <h3 className="text-white font-bold text-base mb-2">{f.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ─────────────────────────────────────────── */}
      <section id="how-it-works" className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-black text-white mb-3">Cara Kerja</h2>
            <p className="text-gray-500">Proses simpel, selesai dalam menit</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Top Up */}
            <div className="bg-[#0b0b1f] border border-brand-600/25 rounded-2xl p-7 bg-gradient-to-br from-brand-600/5 to-transparent">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-brand-600/20 rounded-xl flex items-center justify-center">
                  <ArrowUpRight className="w-5 h-5 text-brand-400" />
                </div>
                <div>
                  <h3 className="text-white font-black text-xl">Top Up</h3>
                  <p className="text-gray-500 text-xs">IDR → Crypto</p>
                </div>
              </div>
              <ol className="space-y-3 mb-7">
                {HOW_TOPUP.map((step, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="w-5 h-5 rounded-full bg-brand-600/20 border border-brand-600/30 text-brand-400 text-xs flex items-center justify-center flex-shrink-0 mt-0.5 font-bold">
                      {i + 1}
                    </span>
                    <span className="text-gray-400 text-sm">{step}</span>
                  </li>
                ))}
              </ol>
              <Link href="/topup" className="btn-primary flex items-center justify-center gap-2 text-sm py-2.5">
                Mulai Top Up <ChevronRight className="w-4 h-4" />
              </Link>
            </div>

            {/* Sell */}
            <div className="bg-[#0b0b1f] border border-green-600/25 rounded-2xl p-7 bg-gradient-to-br from-green-600/5 to-transparent">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-green-600/20 rounded-xl flex items-center justify-center">
                  <ArrowDownLeft className="w-5 h-5 text-green-400" />
                </div>
                <div>
                  <h3 className="text-white font-black text-xl">Sell</h3>
                  <p className="text-gray-500 text-xs">Crypto → IDR</p>
                </div>
              </div>
              <ol className="space-y-3 mb-7">
                {HOW_SELL.map((step, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="w-5 h-5 rounded-full bg-green-600/20 border border-green-600/30 text-green-400 text-xs flex items-center justify-center flex-shrink-0 mt-0.5 font-bold">
                      {i + 1}
                    </span>
                    <span className="text-gray-400 text-sm">{step}</span>
                  </li>
                ))}
              </ol>
              <Link href="/sell" className="btn-secondary flex items-center justify-center gap-2 text-sm py-2.5 border-green-600/30 hover:border-green-500/50">
                Mulai Sell <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── FLOW DIAGRAM ─────────────────────────────────────────── */}
      <section className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto">
          <div className="bg-[#0b0b1f] border border-[#1a1a3e] rounded-2xl p-8 text-center">
            <h2 className="text-2xl font-black text-white mb-2">Alur Pembayaran</h2>
            <p className="text-gray-500 text-sm mb-8">KiPay QRIS untuk pembayaran IDR yang cepat dan aman</p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 flex-wrap">
              {[
                { label: 'Hubungkan Wallet', color: 'brand' },
                { label: '→', color: 'arrow' },
                { label: 'Pilih & Quote', color: 'brand' },
                { label: '→', color: 'arrow' },
                { label: 'QRIS (KiPay)', color: 'yellow' },
                { label: '→', color: 'arrow' },
                { label: 'Verifikasi Server', color: 'brand' },
                { label: '→', color: 'arrow' },
                { label: 'Crypto Terkirim', color: 'green' },
              ].map((item, i) => (
                item.color === 'arrow' ? (
                  <span key={i} className="text-gray-600 text-lg font-bold hidden sm:block">→</span>
                ) : (
                  <div key={i} className={`px-3 py-2 rounded-lg text-xs font-semibold ${
                    item.color === 'brand' ? 'bg-brand-600/15 text-brand-400 border border-brand-600/20' :
                    item.color === 'yellow' ? 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/20' :
                    'bg-green-500/15 text-green-400 border border-green-500/20'
                  }`}>
                    {item.label}
                  </div>
                )
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────── */}
      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mx-auto text-center">
          <div className="bg-gradient-to-br from-brand-600/15 via-purple-600/10 to-transparent border border-brand-600/20 rounded-3xl p-12">
            <h2 className="text-3xl sm:text-4xl font-black text-white mb-4">
              Siap memulai?
            </h2>
            <p className="text-gray-400 mb-8 leading-relaxed">
              Hubungkan wallet dan mulai beli atau jual crypto dengan IDR sekarang.<br />
              Tidak perlu daftar akun — wallet Anda adalah identitas Anda.
            </p>
            <BottomCta />
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
