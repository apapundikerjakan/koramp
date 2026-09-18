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
    loading: () => (
      <div className="min-h-screen bg-base">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-gradient-to-br from-[#C7A048] to-[#1F5C43] rounded-lg flex items-center justify-center">
                <span className="text-white font-black text-sm">K</span>
              </div>
              <span className="text-white font-bold text-xl tracking-tight">Kipramp</span>
            </div>
          </div>
        </div>
        <div className="max-w-2xl mx-auto px-4 py-24 text-center">
          <h1 className="font-display font-black text-ink-primary text-4xl mb-4">
            Tukar <span className="font-black text-[#C7A048]">Rupiah</span> jadi crypto
          </h1>
          <p className="text-ink-secondary mb-8">Loket digital Rupiah ⇄ crypto — tanpa daftar akun.</p>
          <p className="text-ink-muted text-sm animate-pulse" role="status">Memuat aplikasi…</p>
        </div>
      </div>
    ),
  },
);

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <WalletShell>{children}</WalletShell>;
}
