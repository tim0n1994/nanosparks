import { cookies } from 'next/headers';
import Link from 'next/link';
import { buttonStyles } from '@/components/ui/Button';
import { getLang, t } from '@/lib/i18n/getLang';

export default async function NotFound() {
  const lang = getLang((await cookies()).toString());
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-surface px-5 text-center">
      <p className="font-mono text-sm text-ink-muted">404</p>
      <h1 className="mt-2 text-xl font-semibold tracking-tight text-ink">{t('notFound.title', lang)}</h1>
      <p className="mt-2 max-w-sm text-sm text-ink-muted">
        {t('notFound.desc', lang)}
      </p>
      <div className="mt-6 flex items-center gap-3">
        <Link href="/" className={buttonStyles('primary')}>
          {t('shelf.empty.cta', lang)}
        </Link>
        <Link href="/dashboard" className={buttonStyles('secondary')}>
          {t('shelf.title', lang)}
        </Link>
      </div>
    </div>
  );
}
