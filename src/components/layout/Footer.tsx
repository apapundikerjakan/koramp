import Link from 'next/link';

export function Footer() {
  return (
    <footer className="border-t border-[#1a1a3e] mt-24 py-12 bg-[#07071a]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-10">
          <div>
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-7 h-7 bg-gradient-to-br from-brand-500 to-purple-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-black text-xs">K</span>
              </div>
              <span className="text-white font-bold text-lg">Kipramp</span>
            </div>
            <p className="text-gray-500 text-sm leading-relaxed">
              Crypto On/Off-Ramp Marketplace.<br />
              Hubungkan wallet — tanpa daftar akun.
            </p>
            <p className="text-gray-700 text-xs mt-3">SOL · ETH (Base) · BNB</p>
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
              <p>◎ SOL — Solana Network</p>
              <p>Ξ ETH — Base Network</p>
              <p>⬡ BNB — BNB Smart Chain</p>
            </div>
          </div>
        </div>
        <div className="border-t border-[#1a1a3e] pt-6 flex flex-col sm:flex-row justify-between items-center gap-3">
          <p className="text-gray-700 text-xs">© 2024 Kipramp. All rights reserved.</p>
          <p className="text-gray-700 text-xs text-center">
            Software MVP · Bukan layanan keuangan berlisensi · Verifikasi regulasi sebelum produksi
          </p>
        </div>
      </div>
    </footer>
  );
}
