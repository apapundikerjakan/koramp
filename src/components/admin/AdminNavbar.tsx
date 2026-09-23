'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LogOut } from 'lucide-react';
import clsx from 'clsx';

/** Minimal admin header — no wallet bundle (P2/P24). */
export function AdminNavbar({ onLogout }: { onLogout?: () => void }) {
  const pathname = usePathname();
  const [pending, setPending] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch('/api/admin/support?take=1', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (alive && typeof data.pendingCount === 'number') setPending(data.pendingCount);
      } catch {}
    };
    void load();
    const t = setInterval(() => { void load(); }, 30000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const link = (href: string, label: string, badge?: number | null) => {
    const active = pathname === href || (href !== '/admin' && pathname?.startsWith(href));
    return (
      <Link
        href={href}
        aria-current={active ? 'page' : undefined}
        className={clsx(
          'px-3 py-1.5 text-sm rounded-lg flex items-center gap-1.5',
          active ? 'text-white bg-white/10' : 'text-gray-400 hover:text-white hover:bg-white/5',
        )}
      >
        {label}
        {!!badge && badge > 0 && (
          <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </Link>
    );
  };

  return (
    <nav className="sticky top-0 z-40 border-b border-line-subtle bg-base/95 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link href="/admin" className="flex items-center gap-2.5 flex-shrink-0">
            <div className="w-8 h-8 bg-gradient-to-br from-[#C7A048] to-[#1F5C43] rounded-lg flex items-center justify-center">
              <span className="text-white font-black text-sm">K</span>
            </div>
            <span className="text-white font-bold text-lg tracking-tight">KORAMP <span className="text-gray-500 text-sm font-medium">ADMIN</span></span>
          </Link>
          <div className="flex items-center gap-1 overflow-x-auto">
            {link('/admin/orders/topup', 'TopUp')}
            {link('/admin/orders/sell', 'Sell')}
            {link('/admin/support', 'Support', pending)}
            {link('/admin/rewards', 'Rewards')}
            {link('/admin/settings', 'Settings')}
            {link('/admin/security', 'Security')}
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
  if (!value) return <span className="text-gray-600 text-xs">-</span>;
  return <span className="text-gray-500 text-xs font-mono">****{value.slice(-4)}</span>;
}
