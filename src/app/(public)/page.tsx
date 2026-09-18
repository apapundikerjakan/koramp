import Link from 'next/link';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { HeroCta, BottomCta } from '@/components/home/HomeCta';
import { LiveTxFeed } from '@/components/home/LiveTxFeed';
import { RateBoard } from '@/components/home/RateBoard';
import { Reveal, Stagger, StaggerItem } from '@/components/ui/motion';
import { Zap, Shield, Eye, ChevronRight, ArrowUpRight, ArrowDownLeft, Check } from 'lucide-react';
import clsx from 'clsx';

// Server Component (P24) — wallet interactivity isolated in HomeCta islands.

const HOW_TOPUP = ['Hubungkan wallet', 'Pilih crypto (SOL/ETH/BNB)', 'Masukkan nominal IDR', 'Dapatkan quote instan', 'Bayar via QRIS', 'Crypto masuk ke wallet'];
const HOW_SELL = ['Hubungkan wallet', 'Pilih crypto yang dijual', 'Masukkan jumlah', 'Dapatkan quote IDR', 'Kirim ke alamat deposit', 'Terima IDR ke rekening bank'];

const FEATURES = [
  { icon: Zap, title: 'Tanpa daftar akun', desc: 'Cukup hubungkan wallet. Tidak perlu email, password, atau registrasi.', tile: 'bg-[#C7A048]/10 text-[#D9B75F]' },
  { icon: Eye, title: 'Harga transparan', desc: 'Lihat rate, biaya layanan, dan total yang diterima sebelum konfirmasi.', tile: 'bg-[#1F5C43]/15 text-[#2A7A58]' },
  { icon: Shield, title: 'Diverifikasi server', desc: 'Pembayaran dicek server-ke-server. Private key tidak pernah diminta.', tile: 'bg-[#C7A048]/10 text-[#D9B75F]' },
];

const TRUST = ['Tanpa daftar akun', 'Harga transparan', 'Diverifikasi otomatis'];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-base">
      <Navbar />

      {/* ── HERO: loket + papan kurs ─────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 ledger-grid pointer-events-none" aria-hidden />

        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-14 sm:pt-20 pb-16">
          <div className="grid lg:grid-cols-[1.15fr_1fr] gap-10 items-start">
            <div>
              {/* Eyebrow — kalimat aktif, tanpa middle-dot */}
              <p className="text-sm text-ink-secondary mb-5">
                Loket digital Rupiah <span className="text-[#C7A048] font-semibold">⇄</span> crypto
                <span className="block text-ink-muted text-[13px] mt-1">Tanpa daftar akun. Cukup hubungkan wallet.</span>
              </p>

              <h1 className="font-display font-black text-ink-primary text-[2.6rem] sm:text-6xl leading-[1.04] mb-6">
                Tukar <span className="font-black text-[#C7A048]">Rupiah</span> jadi crypto dalam hitungan menit
              </h1>

              <p className="text-ink-secondary text-lg leading-relaxed mb-8 max-w-xl">
                Pilih aset, kunci quote, bayar via QRIS atau kirim crypto —
                sisanya diverifikasi otomatis sampai beres.
              </p>

              <HeroCta />

              {/* Trust row — klaim yang sama dengan FEATURES */}
              <ul className="flex flex-wrap gap-x-5 gap-y-2 mt-8" aria-label="Jaminan layanan">
                {TRUST.map((t) => (
                  <li key={t} className="flex items-center gap-1.5 text-sm text-ink-secondary">
                    <Check className="w-4 h-4 text-[#4CAF6D]" aria-hidden />
                    {t}
                  </li>
                ))}
              </ul>
            </div>

            <Reveal delay={0.1}>
              <RateBoard />
              <p className="text-ink-muted text-xs mt-3 leading-relaxed">
                Angka di papan bersifat indikatif. Nominal final dikunci lewat quote
                saat kamu buat order — tidak pernah berubah sepihak.
              </p>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── ARUS LOKET ───────────────────────────────────────────── */}
      <section className="py-10 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto">
          <Reveal className="flex items-baseline justify-between mb-4">
            <h2 className="font-display font-semibold text-xl text-ink-primary">Arus loket terkini</h2>
            <span className="text-ink-muted text-xs">contoh tampilan</span>
          </Reveal>
          <Reveal delay={0.05}>
            <LiveTxFeed />
          </Reveal>
        </div>
      </section>

      {/* ── FEATURES ─────────────────────────────────────────────── */}
      <section className="py-14 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <Stagger className="grid grid-cols-1 sm:grid-cols-3 gap-5" gap={0.1}>
            {FEATURES.map(f => (
              <StaggerItem key={f.title}>
                <div className="bg-surface-1 border border-line-subtle rounded-2xl p-6 h-full">
                  <div className={clsx('w-11 h-11 rounded-xl flex items-center justify-center mb-4', f.tile)}>
                    <f.icon className="w-5 h-5" aria-hidden />
                  </div>
                  <h3 className="text-ink-primary font-bold text-base mb-2">{f.title}</h3>
                  <p className="text-ink-secondary text-sm leading-relaxed">{f.desc}</p>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* ── HOW IT WORKS ─────────────────────────────────────────── */}
      <section id="how-it-works" className="py-14 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <Reveal className="mb-10">
            <h2 className="font-display font-semibold text-3xl sm:text-4xl text-ink-primary mb-2">Cara kerja</h2>
            <p className="text-ink-secondary">Proses simpel, selesai dalam menit</p>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Top Up */}
            <Reveal>
              <div className="bg-surface-1 border border-line rounded-2xl p-7 h-full">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-[#C7A048]/10 border border-[#C7A048]/25 rounded-xl flex items-center justify-center">
                    <ArrowUpRight className="w-5 h-5 text-[#C7A048]" aria-hidden />
                  </div>
                  <div>
                    <h3 className="text-ink-primary font-bold text-xl">Top Up</h3>
                    <p className="text-ink-muted text-xs">IDR → Crypto</p>
                  </div>
                </div>
                <ol className="space-y-3 mb-7">
                  {HOW_TOPUP.map((step, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <span className="tnum w-5 h-5 rounded-full bg-[#C7A048]/10 border border-[#C7A048]/25 text-[#C7A048] text-xs flex items-center justify-center flex-shrink-0 mt-0.5 font-semibold" aria-hidden>
                        {i + 1}
                      </span>
                      <span className="text-ink-secondary text-sm">{step}</span>
                    </li>
                  ))}
                </ol>
                <Link href="/topup" className="btn-primary flex items-center justify-center gap-2 text-sm py-2.5">
                  Mulai Top Up <ChevronRight className="w-4 h-4" aria-hidden />
                </Link>
              </div>
            </Reveal>

            {/* Sell */}
            <Reveal delay={0.1}>
              <div className="bg-surface-1 border border-line rounded-2xl p-7 h-full">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-[#1F5C43]/15 border border-[#1F5C43]/30 rounded-xl flex items-center justify-center">
                    <ArrowDownLeft className="w-5 h-5 text-[#2A7A58]" aria-hidden />
                  </div>
                  <div>
                    <h3 className="text-ink-primary font-bold text-xl">Sell</h3>
                    <p className="text-ink-muted text-xs">Crypto → IDR</p>
                  </div>
                </div>
                <ol className="space-y-3 mb-7">
                  {HOW_SELL.map((step, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <span className="tnum w-5 h-5 rounded-full bg-[#1F5C43]/15 border border-[#1F5C43]/30 text-[#2A7A58] text-xs flex items-center justify-center flex-shrink-0 mt-0.5 font-semibold" aria-hidden>
                        {i + 1}
                      </span>
                      <span className="text-ink-secondary text-sm">{step}</span>
                    </li>
                  ))}
                </ol>
                <Link href="/sell" className="btn-secondary flex items-center justify-center gap-2 text-sm py-2.5">
                  Mulai Sell <ChevronRight className="w-4 h-4" aria-hidden />
                </Link>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── FLOW DIAGRAM ─────────────────────────────────────────── */}
      <section className="py-14 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto">
          <Reveal className="bg-surface-1 border border-line-subtle rounded-2xl p-8 text-center">
            <h2 className="font-display font-semibold text-2xl text-ink-primary mb-2">Alur pembayaran</h2>
            <p className="text-ink-secondary text-sm mb-8">KiPay QRIS untuk pembayaran IDR yang cepat dan aman</p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 flex-wrap">
              {[
                { label: 'Hubungkan Wallet', tone: 'plain' },
                { label: '→', tone: 'arrow' },
                { label: 'Pilih & Quote', tone: 'plain' },
                { label: '→', tone: 'arrow' },
                { label: 'QRIS (KiPay)', tone: 'brass' },
                { label: '→', tone: 'arrow' },
                { label: 'Verifikasi Server', tone: 'plain' },
                { label: '→', tone: 'arrow' },
                { label: 'Crypto Terkirim', tone: 'pine' },
              ].map((item, i) => (
                item.tone === 'arrow' ? (
                  <span key={i} className="text-[#C7A048] text-lg font-bold hidden sm:block animate-pulse-soft" aria-hidden>→</span>
                ) : (
                  <div key={i} className={clsx('px-3 py-2 rounded-lg text-xs font-semibold transition-transform hover:scale-105',
                    item.tone === 'brass' ? 'bg-[#C7A048]/10 text-[#D9B75F] border border-[#C7A048]/25' :
                    item.tone === 'pine' ? 'bg-[#1F5C43]/15 text-[#2A7A58] border border-[#1F5C43]/30' :
                    'bg-surface-2 text-ink-secondary border border-line'
                  )}>
                    {item.label}
                  </div>
                )
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────── */}
      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mx-auto text-center">
          <Reveal className="bg-gradient-to-br from-[#C7A048]/10 via-transparent to-[#1F5C43]/10 border border-line rounded-3xl p-12">
            <h2 className="font-display font-semibold text-3xl sm:text-4xl text-ink-primary mb-4">
              Siap menukar?
            </h2>
            <p className="text-ink-secondary mb-8 leading-relaxed">
              Hubungkan wallet dan mulai beli atau jual crypto dengan IDR sekarang.<br />
              Tidak perlu daftar akun — wallet Anda adalah identitas Anda.
            </p>
            <BottomCta />
          </Reveal>
        </div>
      </section>

      <Footer />
    </div>
  );
}
