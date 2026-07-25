'use client';

import { Spinner } from '@/components/ui/Button';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface LoadingSpinnerProps {
  text?: string;
}

export default function LoadingSpinner({ text }: LoadingSpinnerProps) {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center justify-center gap-3 py-12 text-ink-muted"
    >
      <Spinner className="h-6 w-6" />
      <p className="text-sm">{text ?? t('common.loading')}</p>
    </div>
  );
}
