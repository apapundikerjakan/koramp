import '@rainbow-me/rainbowkit/styles.css';
import { WalletProviders } from '@/providers/WalletProviders';

// Public wallet routes only: /, /topup, /sell, /order/* (P2).
// URLs unchanged (route group does not affect path).
// RainbowKit styles are imported here (server layout) so the admin bundle
// never loads wallet CSS/JS. Dynamic (no static prerender): wallet hooks
// require runtime provider context.
export const dynamic = 'force-dynamic';

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <WalletProviders>{children}</WalletProviders>;
}
