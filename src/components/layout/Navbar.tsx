'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { WalletSidebarButton } from '@/components/wallet/WalletSidebar';
import { Menu, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import clsx from 'clsx';

const NAV_LINKS = [
  { href: '/topup-sell', label: 'Top Up/Sell' },
  { href: '/transactions', label: 'Transactions' },
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
          ? 'border-[#1A1A1A] bg-[#08080A]/85 backdrop-blur-xl'
          : 'border-[#1A1A1A] bg-[#08080A]',
      )}
    >
      {/* FULL-WIDTH bar: tanpa max-width — logo/men/wallet diposisikan
          terhadap viewport, bukan terhadap content container. */}
      <div className="w-full px-6">
        <div className="relative flex items-center justify-between h-16 gap-2">
          {/* KIRI: logo — 24px dari kiri viewport */}
          <Link href="/" className="flex items-center gap-0 group flex-shrink-0" aria-label="KORAMP beranda">
            <Image src="/logo.png" alt="Logo KORAMP" width={30} height={30} className="flex-shrink-0" priority />
            <span className="text-white font-semibold text-base tracking-tight leading-none -ml-1">orAmp</span>
          </Link>

          {/* TENGAH: nav — center viewport absolut, independen dari
              lebar logo/wallet */}
          <div className="hidden md:flex items-center gap-1 absolute left-1/2 -translate-x-1/2">
            {NAV_LINKS.map(link => (
              <Link
                key={link.href}
                href={link.href}
                data-active={pathname === link.href}
                className={clsx(
                  'nav-link px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150 whitespace-nowrap',
                  pathname === link.href
                    ? 'bg-[#D4B78F]/10 text-[#D4B78F]'
                    : 'text-[#8B8B93] hover:text-white hover:bg-white/5'
                )}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* KANAN: wallet — 24px dari kanan viewport */}
          <div className="flex items-center justify-end gap-2 min-w-0">
            <WalletSidebarButton />
            <button
              className="md:hidden text-gray-400 hover:text-white p-2 min-w-[44px] min-h-[44px] flex items-center justify-center flex-shrink-0"
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label={mobileOpen ? 'Tutup menu' : 'Buka menu'}
              aria-expanded={mobileOpen}
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile menu — link navigasi saja, wallet sudah ada di bar */}
        {mobileOpen && (
          <div className="md:hidden border-t border-[#232326] py-3 space-y-1 pb-4 animate-fade-in">
            {NAV_LINKS.map(link => (
              <Link
                key={link.href}
                href={link.href}
                className={clsx(
                  'block px-4 py-2.5 rounded-lg text-sm font-medium',
                  pathname === link.href ? 'bg-[#D4B78F]/10 text-[#D4B78F]' : 'text-gray-400 hover:text-white hover:bg-white/5'
                )}
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </nav>
  );
}
