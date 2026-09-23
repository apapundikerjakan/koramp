import Link from 'next/link';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { ShieldCheck, ArrowRight } from 'lucide-react';

const SECTIONS: Array<{ title: string; body: string[] }> = [
  {
    title: '1. Tanpa akun, tanpa password',
    body: [
      'KORAMP tidak meminta pendaftaran, username, password, email, atau nomor telepon. Alamat wallet publik Anda adalah identitas Anda di aplikasi.',
      'KORAMP tidak meminta atau menyimpan private key, seed phrase, atau recovery phrase wallet pengguna. Tanda tangan wallet hanya dipakai untuk verifikasi dan tidak disimpan sebagai profil.',
    ],
  },
  {
    title: '2. Informasi yang kami kumpulkan',
    body: [
      'Alamat wallet publik dan tipenya (EVM/Solana), detail order (aset, jaringan, nominal IDR dan kripto, biaya, status), referensi transaksi blockchain (tx hash), serta data teknis untuk keamanan layanan seperti log keamanan agregat dan penghitung kunjungan halaman (tanpa identitas).',
      'Untuk order SELL, kami menyimpan nama bank, nomor rekening, dan nama pemilik rekening yang Anda masukkan — hanya dipakai untuk memproses payout ke rekening tersebut.',
      'Melalui fitur Support, kami menerima subjek, isi pesan, alamat wallet, dan referensi order yang Anda pilih untuk dilaporkan.',
    ],
  },
  {
    title: '3. Data wallet dan blockchain',
    body: [
      'Saat Anda menghubungkan wallet, aplikasi membaca alamat publik, jaringan, serta data on-chain (saldo dan status transaksi) langsung dari penyedia blockchain/RPC. Data ini tidak disalin menjadi profil pengguna di database.',
      'Daftar wallet yang pernah terhubung dan pilihan wallet aktif tersimpan secara lokal di browser Anda (localStorage) dan dapat dihapus melalui pengaturan data situs di browser.',
    ],
  },
  {
    title: '4. Ledger transaksi publik',
    body: [
      'KORAMP menampilkan riwayat transaksi global yang dapat dilihat siapa pun. Yang tampil bersifat publik dan terbatas: nomor order/ID publik, sisi BUY/SELL, aset, jaringan, status, alamat wallet yang disamarkan, referensi transaksi blockchain, dan waktu transaksi.',
      'Nomor rekening tidak pernah tampil utuh di area publik — paling banyak 4 digit terakhir. Nama pemilik rekening dan nominal payout tampil sebagai bagian konteks order.',
    ],
  },
  {
    title: '5. Data pembayaran',
    body: [
      'Pembayaran QRIS diproses melalui penyedia pembayaran TransFi. KORAMP mencatat ID order provider, nominal, penyedia, dan status pembayaran dari verifikasi server-ke-server — bukan dari klaim aplikasi pengguna.',
      'KORAMP tidak menyimpan kredensial kartu, PIN, atau kredensial bank Anda. Detail sensitif pembayaran ditangani oleh penyedia pembayaran sesuai kebijakannya masing-masing.',
    ],
  },
  {
    title: '6. Data support',
    body: [
      'Pesan dan konteks support yang Anda kirim dapat diakses oleh personel KORAMP yang berwenang semata untuk menanggapi dan menyelesaikan permintaan Anda. Catatan internal admin tidak pernah ditampilkan ke pengguna.',
    ],
  },
  {
    title: '7. Bagaimana data digunakan',
    body: [
      'Data dipakai untuk menyediakan layanan KORAMP: membuat dan mengelola transaksi, memproses pembayaran dan payout, memverifikasi status transaksi, memberikan dukungan pelanggan, menjaga keamanan aplikasi, mencegah penyalahgunaan/penipuan, menjaga keandalan layanan, serta memenuhi kewajiban hukum yang berlaku bila diwajibkan.',
    ],
  },
  {
    title: '8. Pihak ketiga dan layanan eksternal',
    body: [
      'Pengoperasian aplikasi melibatkan layanan pihak ketiga: jaringan blockchain (Solana, Base, BNB Chain) dan penyedia RPC-nya, payment gateway QRIS (TransFi), sumber harga pasar, embed grafik TradingView, penjelajah blockchain (tautan pelacakan transaksi), serta penyedia infrastruktur/hosting.',
      'Masing-masing tunduk pada kebijakan privasinya sendiri. KORAMP tidak menjual data pengguna dan tidak membagikan data untuk periklanan.',
    ],
  },
  {
    title: '9. Blockchain dan data publik',
    body: [
      'Catatan transaksi KORAMP berbeda dengan data blockchain publik. Transaksi yang tercatat di blockchain (hash, alamat, konfirmasi) bersifat publik dan permanen — tidak dapat dihapus oleh KORAMP.',
      'Menghapus koneksi wallet atau data lokal tidak menghapus data yang sudah tercatat permanen di blockchain.',
    ],
  },
  {
    title: '10. Cookie dan penyimpanan lokal',
    body: [
      'KORAMP memakai penyimpanan teknis agar situs berfungsi: pilihan persetujuan privasi, daftar wallet yang terhubung, dan wallet aktif pilihan Anda — semuanya tersimpan lokal di browser, bukan cookie pelacakan.',
      'Tidak ada cookie iklan atau pelacakan lintas situs. Menghapus data situs di browser akan menghilangkan preferensi lokal tersebut; sebagian tampilan kembali ke bawaan.',
    ],
  },
  {
    title: '11. Penyimpanan dan keamanan data',
    body: [
      'Kami menerapkan langkah-langkah keamanan yang wajar untuk membantu melindungi data, termasuk pembatasan akses operasional hanya untuk personel/sistem yang berwenang, pembatasan percobaan akses, dan pencatatan keamanan.',
      'Tidak ada sistem yang dapat menjamin keamanan mutlak. Data order disimpan selama diperlukan untuk operasional, rekonsiliasi, dan kewajiban hukum yang berlaku.',
    ],
  },
  {
    title: '12. Hak pengguna',
    body: [
      'Anda dapat memutuskan koneksi wallet kapan saja dari panel wallet untuk menghentikan pembacaan data on-chain oleh sesi Anda, serta menghapus data lokal melalui pengaturan browser.',
      'Untuk pertanyaan atau permintaan terkait privasi, silakan hubungi tim KORAMP melalui kanal dukungan resmi yang tersedia di aplikasi.',
    ],
  },
  {
    title: '13. Perubahan kebijakan privasi',
    body: [
      'Kebijakan ini dapat diperbarui mengikuti perkembangan layanan. Versi terbaru selalu tersedia di halaman ini beserta tanggal pembaruannya.',
    ],
  },
  {
    title: '14. Hubungi kami',
    body: [
      'Jika Anda memiliki pertanyaan mengenai privasi, transaksi, penggunaan aplikasi, atau hal lain terkait KORAMP, Anda dapat menghubungi tim kami melalui halaman kontak.',
    ],
  },
];

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-base">
      <Navbar />
      <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 py-10 sm:py-14">
        <p className="text-brand-400 text-xs font-bold uppercase tracking-[0.2em] mb-3">Kebijakan Privasi</p>
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 bg-brand-600/20 rounded-xl flex items-center justify-center flex-shrink-0">
            <ShieldCheck className="w-5 h-5 text-brand-400" aria-hidden />
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-[-0.02em] text-white">Kebijakan Privasi KORAMP</h1>
        </div>
        <p className="text-gray-400 text-sm leading-relaxed mb-2 sm:pl-12">
          Informasi tentang bagaimana KORAMP mengumpulkan, menggunakan, menyimpan, dan melindungi data dalam penggunaan layanan.
        </p>
        <p className="text-gray-500 text-sm mb-8 sm:pl-12">Terakhir diperbarui: September 2026</p>

        <div className="space-y-4">
          {SECTIONS.map((s) => (
            <section key={s.title} className="bg-surface-1 border border-line-subtle rounded-2xl p-5 sm:p-6">
              <h2 className="text-[#F5F5F5] font-semibold text-[15px] mb-2">{s.title}</h2>
              {s.body.map((p, i) => (
                <p key={i} className="text-[#8B8B93] text-sm leading-relaxed mb-2 last:mb-0">{p}</p>
              ))}
            </section>
          ))}
        </div>

        <section id="reward-program" className="bg-surface-1 border border-line-subtle rounded-2xl p-5 sm:p-6 mt-4 scroll-mt-24">
          <h2 className="text-[#F5F5F5] font-semibold text-[15px] mb-2">15. Program Reward KORAMP</h2>
          <p className="text-[#8B8B93] text-sm leading-relaxed mb-2">
            Program reward KORAMP adalah promotional transaction reward — bukan imbal hasil investasi, pendapatan tetap, bunga, atau yield. Reward hanya tersedia bila seluruh ketentuan terpenuhi dan klaim berhasil diproses; aktivitas transaksi saja tidak menjamin reward.
          </p>
          <p className="text-[#8B8B93] text-sm leading-relaxed mb-2">
            Kelayakan dihitung backend KORAMP dari order KORAMP yang memenuhi syarat: hanya transaksi KORAMP yang valid dan selesai yang dihitung; aktivitas blockchain di luar KORAMP serta transaksi pending, gagal, dibatalkan, atau tidak lengkap tidak dihitung. Satu order hanya berkontribusi satu kali. Persyaratan, nominal reward (dapat acak dalam rentang yang dikonfigurasi), dan siklus reward (mis. bulanan) ditetapkan KORAMP dan dapat berubah untuk periode berikutnya tanpa mengubah klaim historis.
          </p>
          <p className="text-[#8B8B93] text-sm leading-relaxed mb-2">
            Data yang diproses untuk reward terbatas pada yang diperlukan: alamat wallet, ID/order publik KORAMP, tipe dan status transaksi, nominal, waktu transaksi, siklus reward, status klaim, network dan wallet tujuan, serta hash transaksi payout. KORAMP tidak meminta atau menyimpan private key, seed phrase, atau recovery phrase pengguna untuk mengikuti program reward.
          </p>
          <p className="text-[#8B8B93] text-sm leading-relaxed mb-2">
            Anti-fraud dan penyalahgunaan reward: KORAMP dapat memeriksa aktivitas yang mengindikasikan manipulasi (nilai client-side, replay/duplikat klaim, multi-wallet untuk menghindari batasan, impersonasi, eksploitasi bug) — banyak wallet yang sah tidak otomatis dianggap curang. Pelanggaran dapat berakibat penolakan, pembatalan, atau penangguhan reward yang wajar dan proporsional.
          </p>
          <p className="text-[#8B8B93] text-sm leading-relaxed mb-0">
            Risiko payout: pengiriman reward bergantung pada ketersediaan jaringan, RPC, konfirmasi blockchain, dan kompatibilitas wallet/network pilihan Anda. Periksa kembali network dan wallet tujuan sebelum klaim; transaksi blockchain yang sudah terkirim bersifat final. Klaim yang tercatat saat ini berstatus reservasi — payout reward belum aktif; validasi teknis hanya berjalan sebagai dry-run oleh admin tanpa memindahkan dana. Jika payout on-chain diaktifkan di kemudian hari: hash/signature transaksi bersifat publik dan dapat dilihat siapa pun, transaksi blockchain umumnya irreversibel, keterlambatan atau kegagalan jaringan dapat terjadi, dan Anda bertanggung jawab memilih wallet/network yang kompatibel. Kelayakan reward tetap tunduk pada ketentuan program; aktivitas manipulatif dapat berakibat penolakan atau penangguhan reward.
          </p>
        </section>

        <div className="bg-surface-1 border border-line-subtle rounded-2xl p-5 sm:p-6 mt-4 text-center">
          <h2 className="text-[#F5F5F5] font-semibold text-[15px] mb-1">Masih punya pertanyaan?</h2>
          <p className="text-[#8B8B93] text-sm leading-relaxed mb-4">
            Hubungi tim KORAMP jika Anda membutuhkan informasi lebih lanjut.
          </p>
          <Link href="/contact" className="btn-secondary text-sm inline-flex items-center gap-1.5">
            Hubungi Kami <ArrowRight className="w-4 h-4" aria-hidden />
          </Link>
        </div>

        <div className="text-center mt-8">
          <Link href="/" className="btn-ghost text-sm">← Kembali ke beranda</Link>
        </div>
      </div>
      <Footer />
    </div>
  );
}
