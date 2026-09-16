'use client';

import Link from 'next/link';
import { LogOut } from 'lucide-react';

/** Minimal admin header — no wallet bundle (P2/P24). */
export function AdminNavbar({ onLogout }: { onLogout?: () => void }) {
  return (
    <nav className="sticky top-0 z-40 border-b border-[#1a1a3e] bg-[#0a0a1a]/95 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link href="/admin" className="flex items-center gap-2.5 flex-shrink-0">
            <div className="w-8 h-8 bg-gradient-to-br from-brand-500 to-purple-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-black text-sm">K</span>
            </div>
            <span className="text-white font-bold text-lg tracking-tight">Kipramp <span className="text-gray-500 text-sm font-medium">ADMIN</span></span>
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/admin/orders/topup" className="px-3 py-1.5 text-sm text-gray-400 hover:text-white rounded-lg hover:bg-white/5">TopUp</Link>
            <Link href="/admin/orders/sell" className="px-3 py-1.5 text-sm text-gray-400 hover:text-white rounded-lg hover:bg-white/5">Sell</Link>
            <Link href="/admin/settings" className="px-3 py-1.5 text-sm text-gray-400 hover:text-white rounded-lg hover:bg-white/5">Settings</Link>
            <Link href="/admin/security" className="px-3 py-1.5 text-sm text-gray-400 hover:text-white rounded-lg hover:bg-white/5">Security</Link>
            {onLogout && (
              <button onClick={onLogout} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10 rounded-lg" title="Logout">
                <LogOut className="w-4 h-4" /> Logout
              </button>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}

/** Mask bank account: BANK ****1234 (P19). Full value only via explicit reveal. */
export function MaskedAccount({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-gray-600 text-xs">—</span>;
  return <span className="text-gray-500 text-xs font-mono">****{value.slice(-4)}</span>;
}
