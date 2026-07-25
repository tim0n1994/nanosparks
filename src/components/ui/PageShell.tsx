'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import Navbar from '@/components/ui/Navbar';
import Button from '@/components/ui/Button';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';

type Width = 'reading' | 'form' | 'app';

const WIDTH: Record<Width, string> = {
  reading: 'max-w-reading',
  form: 'max-w-form',
  app: 'max-w-app',
};

interface PageShellProps {
  /** Omitted when the shell is only rendering a loading/error state. */
  children?: ReactNode;
  width?: Width;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** Rendered above the h1 as a back affordance. */
  breadcrumb?: { href: string; label: string };
  className?: string;
}

/**
 * The page frame for client-rendered routes.
 *
 * Loading and error used to replace the *entire* page — nav bar included —
 * so a failed fetch left the user on a bare red sentence with no way out.
 * Here the chrome is constant and only the content area swaps.
 */
export default function PageShell({
  children,
  width = 'app',
  loading,
  error,
  onRetry,
  breadcrumb,
  className,
}: PageShellProps) {
  const { t } = useTranslation();
  return (
    <div className="min-h-[100dvh] bg-surface">
      <Navbar />
      <main id="main" className={cn('mx-auto px-5 py-8', WIDTH[width], className)}>
        {breadcrumb && (
          <Link
            href={breadcrumb.href}
            className="mb-3 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
          >
            <span aria-hidden="true">←</span> {breadcrumb.label}
          </Link>
        )}

        {loading ? (
          <ContentSkeleton t={t} />
        ) : error ? (
          <div role="alert" className="rounded-xl border border-line bg-surface-raised px-6 py-12 text-center">
            <h2 className="text-lg font-semibold tracking-tight text-ink">{t('error.pageFailed')}</h2>
            <p className="mx-auto mt-1.5 max-w-sm text-sm text-ink-muted">{error}</p>
            <div className="mt-5 flex justify-center gap-3">
              {onRetry && <Button onClick={onRetry}>{t('common.retry')}</Button>}
              <Link
                href="/dashboard"
                className="inline-flex h-10 items-center rounded-lg border border-line px-4 text-sm font-medium text-ink hover:border-ink-muted"
              >
                {t('reader.next.shelf')}
              </Link>
            </div>
          </div>
        ) : (
          children
        )}
      </main>
    </div>
  );
}

function ContentSkeleton({ t }: { t: (k: string) => string }) {
  return (
    <div aria-busy="true" aria-label={t('common.loading')} className="space-y-4">
      <div className="h-7 w-56 animate-pulse rounded-md bg-surface-sunken" />
      <div className="h-4 w-80 animate-pulse rounded-md bg-surface-sunken" />
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-40 animate-pulse rounded-xl bg-surface-sunken" />
        ))}
      </div>
    </div>
  );
}
