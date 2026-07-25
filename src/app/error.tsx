'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import Button, { buttonStyles } from '@/components/ui/Button';
import { useTranslation } from '@/lib/i18n/useTranslation';

/**
 * Route-level error boundary. Replaces the old per-page "bare red sentence"
 * dead ends: the user always gets a retry and a way home.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    console.error('[route error]', error);
  }, [error]);

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-surface px-5 text-center">
      <h1 className="text-xl font-semibold tracking-tight text-ink">{t('error.title')}</h1>
      <p className="mt-2 max-w-sm text-sm text-ink-muted">
        {t('error.desc')}
      </p>
      {error.digest && (
        <p className="mt-2 font-mono text-2xs text-ink-muted">{t('error.digest', { digest: error.digest })}</p>
      )}
      <div className="mt-6 flex items-center gap-3">
        <Button onClick={reset}>{t('common.retry')}</Button>
        <Link href="/" className={buttonStyles('secondary')}>
          {t('error.backHome')}
        </Link>
      </div>
    </div>
  );
}
