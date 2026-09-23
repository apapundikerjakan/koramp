import type { Metadata } from 'next';
import './globals.css';
// Official Solana wallet-adapter modal styles (static CSS only — no wallet
// JS enters the server graph; providers stay mounted on public routes only).
import '@solana/wallet-adapter-react-ui/styles.css';
import { ClientErrorFilter } from '@/components/ui/ClientErrorFilter';

// Root layout is intentionally minimal (P2).
// - NO WalletProviders here (only public wallet routes mount it via (public)/layout).
// - NO AuthProvider here (only /admin/* mounts it via (admin)/layout).
// Route groups (public)/(admin) preserve public URLs while splitting bundles.

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
  title: 'KORAMP: Top Up & Sell Crypto with IDR',
  description: 'Beli SOL, ETH, BNB dengan Rupiah atau jual crypto dan terima IDR langsung ke rekening bank. Cukup hubungkan wallet, tanpa daftar akun.',
  keywords: 'beli crypto IDR, jual crypto rupiah, top up SOL ETH BNB, koramp, kripto Indonesia',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'KORAMP: Crypto On/Off-Ramp Marketplace',
    description: 'Top Up Crypto & Sell Crypto with IDR',
    type: 'website',
    url: '/',
    siteName: 'KORAMP',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className="dark">
      <body>
        <ClientErrorFilter />
        {children}
      </body>
    </html>
  );
}
