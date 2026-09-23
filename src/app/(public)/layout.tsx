import dynamicLoader from 'next/dynamic';
import '@rainbow-me/rainbowkit/styles.css';

// Public wallet routes only: /, /topup, /sell, /order/* (P2).
// URLs unchanged (route group does not affect path).
// RainbowKit styles are imported here (server layout) so the admin bundle
// never loads wallet CSS/JS. Dynamic (no static prerender): wallet hooks
// require runtime provider context.
//
// SSR SAFETY (toolchain fix): the wallet ESM graph (wagmi/RainbowKit/Solana
// adapters) cannot be evaluated in this stack's server module graph — doing
// so 500s every public route ("Element type is invalid: got undefined",
// pre-existing, dev and prod). WalletShell mounts it client-only (ssr:false);
// the server renders a static skeleton shell (real copy, no wallet deps).
// All live data is client-fetched at runtime; middleware still runs
// per request. `useWallet()` tolerates SSR (disconnected defaults).
export const dynamic = 'force-dynamic';

const WalletShell = dynamicLoader(
  () => import('./wallet-shell').then((m) => ({ default: m.WalletShell })),
  {
    ssr: false,
    // Splash minimal tanpa logo lama — PublicLoader mengambil alih
    // segera setelah shell ter-mount.
    loading: () => (
      <div className="min-h-screen bg-[#08080A] flex items-center justify-center">
        <p className="font-bold text-[#F5F5F5] tracking-[-0.02em] text-2xl">KORAMP</p>
      </div>
    ),
  },
);

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <WalletShell>{children}</WalletShell>;
}
