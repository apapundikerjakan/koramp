'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { WalletButton } from '@/components/wallet/WalletButton';
import { Menu, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import clsx from 'clsx';

const NAV_LINKS = [
  { href: '/topup', label: 'Top Up' },
  { href: '/sell', label: 'Sell' },
  { href: '/#how-it-works', label: 'Cara Kerja' },
];

export function Navbar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  // Glassmorphism after 50px scroll (prompt UI §5.2)
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 50);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <nav
      className={clsx(
        'sticky top-0 z-40 border-b transition-all duration-200',
        scrolled
          ? 'border-line-subtle bg-base/80 backdrop-blur-xl'
          : 'border-transparent bg-transparent',
      )}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 group flex-shrink-0" aria-label="Kipramp beranda">
            <div className="w-8 h-8 bg-gradient-to-br from-[#C7A048] to-[#1F5C43] rounded-lg flex items-center justify-center shadow-lg shadow-brand-500/20 transition-transform duration-150 group-hover:scale-105">
              <span className="text-white font-black text-sm">K</span>
            </div>
            <span className="text-white font-bold text-xl tracking-tight">
              Kipramp
              <span className="hidden sm:inline text-gray-600 text-xs font-medium ml-2">on/off-ramp IDR</span>
            </span>
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-1">
            {NAV_LINKS.map(link => (
              <Link
                key={link.href}
                href={link.href}
                data-active={pathname === link.href}
                className={clsx(
                  'nav-link px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150',
                  pathname === link.href
                    ? 'bg-brand-600/20 text-brand-400'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                )}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Right: wallet button */}
          <div className="hidden md:flex items-center">
            <WalletButton />
          </div>

          {/* Mobile toggle */}
          <button
            className="md:hidden text-gray-400 hover:text-white p-2 min-w-[44px] min-h-[44px] flex items-center justify-center"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label={mobileOpen ? 'Tutup menu' : 'Buka menu'}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div className="md:hidden border-t border-line-subtle py-3 space-y-1 pb-4 animate-fade-in">
            {NAV_LINKS.map(link => (
              <Link
                key={link.href}
                href={link.href}
                className={clsx(
                  'block px-4 py-2.5 rounded-lg text-sm font-medium',
                  pathname === link.href ? 'bg-brand-600/20 text-brand-400' : 'text-gray-400 hover:text-white hover:bg-white/5'
                )}
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </Link>
            ))}
            <div className="pt-2 px-2">
              <WalletButton />
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
