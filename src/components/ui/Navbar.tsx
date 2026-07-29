'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
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
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="text-accent-600" aria-hidden="true">
            <path
              d="M3 14L7 4L9 10L11 6L15 14"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
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
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <kbd className="hidden font-mono text-2xs sm:inline">⌘K</kbd>
          </button>

          {isValidClerkKey && <ClerkAuthSection />}

          <Link
            href="/settings"
            aria-label={t('nav.settings')}
            aria-current={isActive('/settings') ? 'page' : undefined}
            className={cn('text-ink-muted transition-colors hover:text-ink', TAP_TARGET)}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 10.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 1v2M8 13v2M15 8h-2M3 8H1M12.95 3.05l-1.41 1.41M4.46 11.54l-1.41 1.41M12.95 12.95l-1.41-1.41M4.46 4.46L3.05 3.05" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M6.5 1.5L6 3.5a3.5 3.5 0 00-1.5.9l-2-.5-.5 1.5 1.7 1a3.7 3.7 0 000 1.2l-1.7 1 .5 1.5 2-.5a3.5 3.5 0 001.5.9l.5 2h1.5l.5-2a3.5 3.5 0 001.5-.9l2 .5.5-1.5-1.7-1a3.7 3.7 0 000-1.2l1.7-1-.5-1.5-2 .5a3.5 3.5 0 00-1.5-.9L9.5 1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
            </svg>
          </Link>

          <LangToggle />
        </div>
      </nav>
    </header>
  );
}
