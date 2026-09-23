import Link from 'next/link';
import Image from 'next/image';
import { QrCode } from 'lucide-react';
import { TokenIcon } from '@/components/ui/TokenIcon';

export function Footer() {
  return (
    <footer className="border-t border-[#1A1A1A] mt-16 py-12 bg-[#08080A]">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-10">
          <div>
            <div className="flex items-center gap-2.5 mb-4">
              <Image src="/logo.png" alt="Logo KORAMP" width={26} height={26} />
              <span className="text-white font-semibold text-base">KORAMP</span>
            </div>
            <p className="text-[#8B8B93] text-sm leading-relaxed">
              Crypto On/Off-Ramp Marketplace.<br />
              Hubungkan wallet, tanpa daftar akun.
            </p>
            <p className="text-[#5A5A60] text-xs mt-3">SOL · ETH (Base) · BNB</p>
            <span className="inline-flex items-center gap-1.5 mt-4 px-3 py-1.5 rounded-full text-xs font-semibold text-[#D4B78F] border border-[#D4B78F]/40 bg-transparent">
              <QrCode className="w-3 h-3" aria-hidden />
              Powered by TransFi QRIS
            </span>
          </div>
          <div>
            <p className="text-[#F5F5F5] font-semibold text-sm mb-3">Produk</p>
            <div className="space-y-2">
              <Link href="/topup-sell" className="block text-[#8B8B93] hover:text-[#F5F5F5] text-sm transition-colors">Top Up/Sell Crypto</Link>
            </div>
          </div>
          <div>
            <p className="text-[#F5F5F5] font-semibold text-sm mb-3">Hubungi Kami</p>
            <div className="space-y-2">
              <Link href="/contact" className="block text-[#8B8B93] hover:text-[#F5F5F5] text-sm transition-colors">Hubungi Kami</Link>
              <Link href="/privacy" className="block text-[#8B8B93] hover:text-[#F5F5F5] text-sm transition-colors">Kebijakan Privasi</Link>
            </div>
          </div>
          <div>
            <p className="text-[#F5F5F5] font-semibold text-sm mb-3">Aset yang Didukung</p>
            <div className="space-y-2 text-sm text-[#8B8B93]">
              <p className="flex items-center gap-1.5"><TokenIcon symbol="SOL" size={14} /> SOL - Solana Network</p>
              <p className="flex items-center gap-1.5"><TokenIcon symbol="ETH" size={14} /> ETH - Base Network</p>
              <p className="flex items-center gap-1.5"><TokenIcon symbol="BNB" size={14} /> BNB - BNB Smart Chain</p>
            </div>
          </div>
        </div>
        <div className="border-t border-[#1A1A1A] pt-6 flex flex-col sm:flex-row justify-between items-center gap-3">
          <p className="text-[#5A5A60] text-xs">© 2024 KORAMP. All rights reserved.</p>
          <p className="text-[#5A5A60] text-xs text-center sm:text-right">
            Software MVP · Bukan layanan keuangan berlisensi · Verifikasi regulasi sebelum produksi
          </p>
        </div>
      </div>
    </footer>
  );
}
