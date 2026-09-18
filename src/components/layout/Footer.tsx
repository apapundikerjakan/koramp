import Link from 'next/link';
import { QrCode } from 'lucide-react';
import { TokenIcon } from '@/components/ui/TokenIcon';

export function Footer() {
  return (
    <footer className="border-t border-line-subtle mt-24 py-12 bg-base">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-10">
          <div>
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-7 h-7 bg-gradient-to-br from-[#C7A048] to-[#1F5C43] rounded-lg flex items-center justify-center">
                <span className="text-white font-black text-xs">K</span>
              </div>
              <span className="text-white font-bold text-lg">Kipramp</span>
            </div>
            <p className="text-gray-500 text-sm leading-relaxed">
              Crypto On/Off-Ramp Marketplace.<br />
              Hubungkan wallet — tanpa daftar akun.
            </p>
            <p className="text-gray-700 text-xs mt-3">SOL · ETH (Base) · BNB</p>
            <span className="inline-flex items-center gap-1.5 mt-4 px-2.5 py-1 rounded-full text-xs font-semibold bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
              <QrCode className="w-3 h-3" aria-hidden />
              Powered by KiPay QRIS
            </span>
          </div>
          <div>
            <p className="text-gray-400 font-semibold text-sm mb-3">Produk</p>
            <div className="space-y-2">
              <Link href="/topup" className="block text-gray-500 hover:text-gray-300 text-sm transition-colors">Top Up Crypto</Link>
              <Link href="/sell" className="block text-gray-500 hover:text-gray-300 text-sm transition-colors">Sell Crypto</Link>
            </div>
          </div>
          <div>
            <p className="text-gray-400 font-semibold text-sm mb-3">Aset yang Didukung</p>
            <div className="space-y-2 text-sm text-gray-500">
              <p className="flex items-center gap-1.5"><TokenIcon symbol="SOL" size={14} /> SOL — Solana Network</p>
              <p className="flex items-center gap-1.5"><TokenIcon symbol="ETH" size={14} /> ETH — Base Network</p>
              <p className="flex items-center gap-1.5"><TokenIcon symbol="BNB" size={14} /> BNB — BNB Smart Chain</p>
            </div>
          </div>
        </div>
        <div className="border-t border-line-subtle pt-6 flex flex-col sm:flex-row justify-between items-center gap-3">
          <p className="text-gray-700 text-xs">© 2024 Kipramp. All rights reserved.</p>
          <p className="text-gray-700 text-xs text-center">
            Software MVP · Bukan layanan keuangan berlisensi · Verifikasi regulasi sebelum produksi
          </p>
        </div>
      </div>
    </footer>
  );
}
