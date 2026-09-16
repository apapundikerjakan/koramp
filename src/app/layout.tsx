import type { Metadata } from 'next';
import './globals.css';

// Root layout is intentionally minimal (P2).
// - NO WalletProviders here (only public wallet routes mount it via (public)/layout).
// - NO AuthProvider here (only /admin/* mounts it via (admin)/layout).
// Route groups (public)/(admin) preserve public URLs while splitting bundles.

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
  title: 'Kipramp — Top Up & Sell Crypto with IDR',
  description: 'Beli SOL, ETH, BNB dengan Rupiah atau jual crypto dan terima IDR langsung ke rekening bank. Cukup hubungkan wallet — tanpa daftar akun.',
  keywords: 'beli crypto IDR, jual crypto rupiah, top up SOL ETH BNB, kipramp, kripto Indonesia',
  openGraph: {
    title: 'Kipramp — Crypto On/Off-Ramp Marketplace',
    description: 'Top Up Crypto & Sell Crypto with IDR',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className="dark">
      <body>{children}</body>
    </html>
  );
}
