import Link from 'next/link';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { Mail, ArrowUpRight } from 'lucide-react';

const EMAIL = 'Kipramp@proton.me';

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-base">
      <Navbar />
      <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 py-10 sm:py-14">
        <p className="text-brand-400 text-xs font-bold uppercase tracking-[0.2em] mb-3">Contact</p>
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 bg-brand-600/20 rounded-xl flex items-center justify-center flex-shrink-0">
            <Mail className="w-5 h-5 text-brand-400" aria-hidden />
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-[-0.02em] text-white">Hubungi Tim KORAMP</h1>
        </div>
        <p className="text-gray-400 text-sm leading-relaxed mb-8 sm:pl-12">
          Jika Anda memiliki pertanyaan, mengalami masalah, atau ingin menghubungi tim KORAMP, silakan hubungi kami melalui email.
        </p>

        <section className="bg-surface-1 border border-line-subtle rounded-2xl p-5 sm:p-6">
          <h2 className="text-[#F5F5F5] font-semibold text-[15px] mb-2">Hubungi Tim KORAMP</h2>
          <p className="text-[#8B8B93] text-sm leading-relaxed mb-4">
            Untuk pertanyaan, bantuan, laporan masalah, feedback, atau kebutuhan lainnya terkait KORAMP, silakan hubungi tim kami melalui:
          </p>
          <a
            href={`mailto:${EMAIL}`}
            className="block text-center sm:inline-block text-brand-400 hover:text-white font-semibold text-base break-all border border-brand-500/30 bg-brand-600/10 hover:bg-brand-600/20 rounded-xl px-5 py-3 transition-colors"
          >
            {EMAIL}
          </a>
          <div className="mt-4">
            <a href={`mailto:${EMAIL}`} className="btn-primary text-sm inline-flex items-center gap-1.5">
              Email Tim KORAMP <ArrowUpRight className="w-4 h-4" aria-hidden />
            </a>
          </div>
        </section>

        <div className="text-center mt-8">
          <Link href="/" className="btn-ghost text-sm">← Kembali ke beranda</Link>
        </div>
      </div>
      <Footer />
    </div>
  );
}
