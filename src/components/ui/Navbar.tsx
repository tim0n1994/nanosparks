'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { Search, Sparkles } from 'lucide-react';
import { isValidClerkKey } from '@/lib/clerk-utils';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { openSearch } from '@/components/search/openSearch';
import { TAP_TARGET } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import LangToggle from './LangToggle';

const ClerkAuthSection = dynamic(() => import('./ClerkAuthSection'), { ssr: false });

const NAV_ITEMS = [
  { href: '/submit', key: 'nav.read' },
  { href: '/dashboard', key: 'nav.shelf' },
  { href: '/corpora', key: 'nav.corpora' },
  { href: '/settings', key: 'nav.settings' },
] as const;

export default function Navbar() {
  const pathname = usePathname();
  const { t } = useTranslation();

  const isActive = (href: string) =>
    pathname === href || (pathname?.startsWith(href + '/') ?? false);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface-raised/85 backdrop-blur-xl">
      <nav
        aria-label={t('nav.primary')}
        className="mx-auto flex h-13 max-w-app items-center justify-between gap-2 px-4 py-3 sm:gap-3 sm:px-5"
      >
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 text-base font-semibold tracking-tight text-ink"
        >
          <Sparkles className="size-4.5 text-accent-600" strokeWidth={1.5} aria-hidden="true" />
          <span className="hidden sm:inline">NanoSparks</span>
        </Link>

        <div className="flex min-w-0 items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors sm:px-3',
                  TAP_TARGET,
                  active
                    ? 'bg-ink text-surface-raised'
                    : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
                )}
              >
                {t(item.key)}
              </Link>
            );
          })}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* Cmd+K was undiscoverable — this is the visible entry point, and the
              only way in on touch devices. */}
          <button
            type="button"
            onClick={openSearch}
            aria-label={t('nav.search')}
            className={cn(
              'flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-ink-muted transition-colors hover:border-ink-muted hover:text-ink',
              TAP_TARGET,
            )}
          >
            <Search className="size-4" strokeWidth={1.5} aria-hidden="true" />
            <kbd className="hidden font-mono text-2xs sm:inline">⌘K</kbd>
          </button>

          {isValidClerkKey && <ClerkAuthSection />}

          <LangToggle />
        </div>
      </nav>
    </header>
  );
}
