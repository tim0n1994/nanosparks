'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { isValidClerkKey } from '@/lib/clerk-utils';
import { useTranslation } from '@/lib/i18n/useTranslation';
import LangToggle from './LangToggle';

const ClerkAuthSection = dynamic(() => import('./ClerkAuthSection'), { ssr: false });

const NAV_ITEMS = [
  { href: '/submit', key: 'nav.analyze', label: '读' },
  { href: '/dashboard', key: 'nav.dashboard', label: '控制台' },
  { href: '/corpora', key: 'nav.search', label: '搜索' },
] as const;

export default function Navbar() {
  const pathname = usePathname();
  const { t } = useTranslation();

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200/60 bg-white/80 backdrop-blur-xl">
      <nav className="mx-auto flex h-13 max-w-[1100px] items-center justify-between px-5 py-3">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-zinc-900">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="text-accent-600">
            <path d="M3 14L7 4L9 10L11 6L15 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>NanoSparks</span>
        </Link>

        {/* Center nav */}
        <div className="flex items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || pathname?.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
                  active
                    ? 'bg-zinc-900 text-white'
                    : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>

        {/* Right cluster */}
        <div className="flex items-center gap-3">
          {isValidClerkKey && <ClerkAuthSection />}
          <Link
            href="/settings"
            className="text-zinc-400 transition-colors hover:text-zinc-700"
            title="设置"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 10.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 1.5v1.5M8 13v1.5M14.5 8H13M3 8H1.5M12.6 3.4l-1 1M4.4 11.6l-1 1M12.6 12.6l-1-1M4.4 4.4l-1-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </Link>
          <LangToggle />
        </div>
      </nav>
    </header>
  );
}
