import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { BottomCta } from '@/components/home/HomeCta';
import { WhyCards } from '@/components/home/WhyCards';
import { EcosystemMarquee } from '@/components/home/EcosystemMarquee';
import { Reveal, Stagger, StaggerItem } from '@/components/ui/motion';
import { ScrollVideo } from '@/components/3d/ScrollVideo';
import { SplitSection } from '@/components/3d/SplitSection';
import {
  ArrowDownLeft, Check,
  Wallet, QrCode, ArrowRightLeft,
} from 'lucide-react';

// KORAMP landing — struktur adaptasi Normies, branding & rails IDR milik KORAMP.
// Luxury system: bg #08080A, card #141416 / #232326, gold #D4B78F, green #22C55E.

const RAILS = [
  {
    n: '01',
    title: 'Kumpulkan',
    desc: 'Terima pembayaran IDR via QRIS (KiPay) dan settle ke crypto: SOL, ETH, BNB. Quote dikunci di awal, tidak berubah sepihak.',
    icon: QrCode,
  },
  {
    n: '02',
    title: 'Cairkan',
    desc: 'Kirim crypto ke alamat deposit, terima IDR ke rekening bank lokal: BCA, BRI, BNI, Mandiri, dan lainnya. Cepat dan always-on.',
    icon: ArrowDownLeft,
  },
  {
    n: '03',
    title: 'Otomatiskan',
    desc: 'Routing quote, likuiditas, dan verifikasi server-ke-server berjalan otomatis. Kamu cukup hubungkan wallet.',
    icon: RefreshCwIcon,
  },
];

function RefreshCwIcon(props: { className?: string }) {
  return <ArrowRightLeft {...props} aria-hidden />;
}

const SEGMENTS = [
  {
    title: 'Trader Retail',
    desc: 'Beli dan jual SOL, ETH, BNB dengan Rupiah tanpa daftar akun. Hubungkan wallet, kunci quote, beres.',
    tag: 'Top Up & Sell instan',
  },
  {
    title: 'Freelancer & Global Earner',
    desc: 'Terima penghasilan crypto global dan cairkan ke IDR ke rekening bank lokal dengan biaya prediktabel.',
    tag: 'Crypto → IDR',
  },
  {
    title: 'Komunitas Web3',
    desc: 'Onboarding rupiah untuk anggota komunitas, bayar via QRIS, crypto masuk langsung ke wallet masing-masing.',
    tag: 'QRIS → Wallet',
  },
  {
    title: 'UMKM & Bisnis Digital',
    desc: 'Terima pembayaran crypto global, settle instan dalam IDR. Satu integrasi simpel untuk kas yang bergerak cepat.',
    tag: 'Satu loket kas',
  },
];

const STATS = [
  { value: 'Rp 850Jt+', label: 'Volume IDR terproses' },
  { value: '12.400+', label: 'Total transaksi' },
  { value: '99,9%', label: 'Uptime layanan' },
];

const TRUST = ['Tanpa daftar akun', 'Harga transparan', 'Diverifikasi otomatis'];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-base">
      <Navbar />

      {/* ── 1. HERO: video background HD ─────────────────────────────── */}
      <section className="relative overflow-hidden">
        <video
          className="absolute inset-0 h-full w-full object-cover motion-reduce:hidden"
          src="/videos/kipramp-hero.mp4"
          poster="/videos/kipramp-hero-poster.jpg"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          aria-hidden
        />
        <div className="absolute inset-0 bg-[#08080A]/60 pointer-events-none" aria-hidden />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: [
              'linear-gradient(to bottom, #08080A 0%, transparent 22%)',
              'linear-gradient(to top, #08080A 0%, transparent 26%)',
              'radial-gradient(ellipse 75% 65% at 50% 45%, rgba(8,8,10,0.55) 0%, transparent 70%)',
            ].join(', '),
          }}
          aria-hidden
        />
        <div className="absolute inset-0 ledger-grid pointer-events-none" aria-hidden />

        <div className="relative max-w-[900px] mx-auto px-4 sm:px-6 pt-16 sm:pt-24 pb-16 sm:pb-24 text-center flex flex-col items-center justify-center">
          <p className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-[#D4B78F]/40 text-xs font-semibold tracking-wide text-[#D4B78F] mb-5">
            ON/OFF-RAMP IDR <span aria-hidden>⇄</span> CRYPTO GLOBAL
          </p>

          <h1 className="font-bold text-[#F5F5F5] text-[clamp(42px,6vw,72px)] leading-[1.08] tracking-[-0.02em] mb-6">
            Terima crypto global, settle <span className="font-bold text-[#D4B78F]">Rupiah</span> instan
          </h1>

          <p className="text-[#CFCFD4] text-sm leading-relaxed mb-8 max-w-[700px] mx-auto">
            Rails modern untuk settlement IDR yang cepat, andal, dan skalabel.
            Settlement cepat. Fee rendah. Satu loket sederhana.
          </p>

          <ul className="flex flex-wrap justify-center gap-x-6 gap-y-2" aria-label="Jaminan layanan">
            {TRUST.map((t) => (
              <li key={t} className="flex items-center gap-1.5 text-sm text-[#CFCFD4]">
                <Check className="w-4 h-4 text-[#22C55E]" aria-hidden />
                {t}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── 2. ECOSYSTEM MARQUEE (fills the strip below hero) ─────────── */}
      <section className="px-4 sm:px-6 py-8 sm:py-10" aria-label="Ekosistem KORAMP">
        <div className="max-w-[1200px] mx-auto">
          <EcosystemMarquee />
        </div>
      </section>

      {/* ── 3. MODERN RAILS untuk settlement IDR ── + ScrollVideo (visual kanan) */}
      <SplitSection
        eyebrow="Rails modern"
        pin
        title="Rails modern untuk settlement IDR"
        desc="Satu cara terpadu memindahkan uang antar pasar, dengan kecepatan, presisi, dan skala."
        visual={
          <ScrollVideo
            src="/videos/rails-hub.mp4"
            srcRev="/videos/rails-hub-rev.mp4"
            poster="/videos/rails-hub-poster.jpg"
            label="Video hub KORAMP: globe, koin crypto, bank IDR, dan wallet, bergerak mengikuti scroll"
          />
        }
      >
        <Stagger className="flex flex-col" gap={0.08}>
          {RAILS.map((r) => (
            <StaggerItem key={r.n}>
              <div className="flex gap-4 py-5 border-t border-[#232326] first:border-t-0 first:pt-0">
                <span className="tnum text-[#8B8B93] text-sm pt-0.5 w-7 flex-shrink-0">{r.n}</span>
                <div className="w-10 h-10 rounded-xl bg-[#D4B78F]/10 border border-[#D4B78F]/25 flex items-center justify-center flex-shrink-0">
                  <r.icon className="w-5 h-5 text-[#D4B78F]" aria-hidden />
                </div>
                <div>
                  <h3 className="text-[#F5F5F5] font-semibold text-lg tracking-[-0.02em] mb-1">{r.title}</h3>
                  <p className="text-[#8B8B93] text-sm leading-relaxed">{r.desc}</p>
                </div>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      </SplitSection>

      {/* ── 3. WHY KORAMP (stacked cards pin) ─────────────────────── */}
      <WhyCards />
      {/* ── 4. BUILT FOR Indonesians that move money ── + ScrollVideo (visual kiri) */}
      <SplitSection
        eyebrow="Untuk siapa"
        title="Dibangun untuk Indonesia yang menggerakkan uang"
        desc="Terima crypto global, settle instan dalam IDR, dan upgrade pengalaman pembayaranmu — dengan satu loket sederhana."
        reverse
        visual={
          <ScrollVideo
            src="/videos/segments-global.mp4"
            srcRev="/videos/segments-global-rev.mp4"
            poster="/videos/segments-global-poster.jpg"
            label="Video metode pembayaran global mengelilingi globe, bergerak mengikuti scroll"
          />
        }
      >
        <Stagger className="flex flex-col" gap={0.08}>
          {SEGMENTS.map((s) => (
            <StaggerItem key={s.title}>
              <div className="py-5 border-t border-[#232326] first:border-t-0 first:pt-0">
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold text-[#D4B78F] border border-[#D4B78F]/40 mb-3">
                  {s.tag}
                </span>
                <h3 className="text-[#F5F5F5] font-semibold text-lg tracking-[-0.02em] mb-1">{s.title}</h3>
                <p className="text-[#8B8B93] text-sm leading-relaxed">{s.desc}</p>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      </SplitSection>

      {/* ── 5. SIMPLE-FIRST (adaptasi developer-first) ── + ScrollVideo (visual kanan) */}
      <SplitSection
        id="how-it-works"
        pin
        eyebrow="Simple-first"
        title={<>Simple-first,<br />dari fondasinya</>}
        desc="Wallet-mu adalah identitasmu. Tanpa email, tanpa password. Quote transparan, verifikasi otomatis, payout ke bank, siap produksi dari hari pertama."
        visual={
          <ScrollVideo
            src="/videos/simple-hub.mp4"
            srcRev="/videos/simple-hub-rev.mp4"
            poster="/videos/simple-hub-poster.jpg"
            label="Video podium dengan peta dunia di latar, bergerak mengikuti scroll"
          />
        }
      >
        <div className="flex flex-col gap-6">
          <div className="bg-[#141416] border border-[#232326] rounded-xl p-6 flex flex-col justify-center" style={{ backdropFilter: 'blur(12px)' }}>
            <div className="flex items-center gap-2 mb-2">
              <Wallet className="w-4 h-4 text-[#D4B78F]" aria-hidden />
              <p className="text-[#F5F5F5] font-semibold text-sm">Tanpa daftar akun</p>
            </div>
            <p className="text-[#8B8B93] text-sm leading-relaxed mb-5">
              Hubungkan wallet. Quote, pembayaran QRIS, dan payout berjalan otomatis sampai beres.
            </p>
            <div className="flex flex-col gap-3">
              {['Hubungkan wallet', 'Kunci quote instan', 'Bayar via QRIS / kirim crypto'].map((s, i) => (
                <div key={s} className="flex items-center gap-3">
                  <span className="tnum w-6 h-6 rounded-full bg-[#D4B78F]/10 border border-[#D4B78F]/25 text-[#D4B78F] text-xs flex items-center justify-center font-semibold" aria-hidden>
                    {i + 1}
                  </span>
                  <span className="text-[#8B8B93] text-sm">{s}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </SplitSection>

      {/* ── 6. STATS ───────────────────────────────────────────────── */}
      <section className="py-12 sm:py-16 px-4 sm:px-6">
        <div className="max-w-[1200px] mx-auto">
          <Reveal className="bg-[#141416] border border-[#232326] rounded-xl p-6 sm:p-10" >
            <p className="text-[#8B8B93] text-sm mb-8 text-center">Infrastruktur yang membuat kasmu terus bergerak</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 text-center">
              {STATS.map((s) => (
                <div key={s.label}>
                  <p className="tnum font-bold text-3xl sm:text-4xl text-[#D4B78F] mb-2">{s.value}</p>
                  <p className="text-[#8B8B93] text-sm">{s.label}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── 7. FINAL CTA ───────────────────────────────────────────── */}
      <section className="py-12 sm:py-16 px-4 sm:px-6">
        <div className="max-w-[1200px] mx-auto">
          <Reveal className="bg-[#141416] border border-[#232326] rounded-xl p-8 sm:p-12 text-center" >
            <h2 className="font-semibold text-3xl sm:text-4xl text-[#F5F5F5] tracking-[-0.02em] mb-4">
              Siap modernisasi kas IDR ↔ crypto?
            </h2>
            <p className="text-[#8B8B93] text-sm mb-8 leading-relaxed max-w-xl mx-auto">
              Lihat bagaimana KORAMP membantumu terima crypto global, settle instan dalam IDR,
              menekan biaya, dan memberikan pengalaman pembayaran yang lebih cepat, semua lewat satu loket sederhana.
            </p>
            <BottomCta />
          </Reveal>
        </div>
      </section>

      <Footer />
    </div>
  );
}
