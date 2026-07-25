'use client';

import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { TAP_TARGET } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

export default function LangToggle() {
  const { lang, toggleLang } = useI18n();
  const router = useRouter();
  const label = lang === 'en' ? '切换到中文' : 'Switch to English';

  return (
    <button
      type="button"
      onClick={() => {
        toggleLang();
        // Client components re-render from context, but every server component
        // reads the language from the cookie at render time — without this the
        // nav switched to English while the page body stayed Chinese.
        router.refresh();
      }}
      aria-label={label}
      title={label}
      className={cn(
        'rounded-md border border-line px-2 py-1 text-2xs font-medium text-ink-muted transition-colors hover:border-ink-muted hover:text-ink',
        TAP_TARGET,
      )}
    >
      {lang === 'en' ? '中文' : 'EN'}
    </button>
  );
}
