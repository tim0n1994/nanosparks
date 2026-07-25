'use client';

import { useTranslation } from '@/lib/i18n/useTranslation';

interface EmptyStateProps {
  title?: string;
  description?: string;
  action?: React.ReactNode;
}

/** Empty states always offer the next action — never a dead end. */
export default function EmptyState({ title, description, action }: EmptyStateProps) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-line bg-surface-raised px-6 py-12 text-center">
      <h3 className="text-lg font-semibold tracking-tight text-ink">{title ?? t('empty.default.title')}</h3>
      <p className="mx-auto mt-1.5 max-w-sm text-sm text-ink-muted">{description ?? t('empty.default.desc')}</p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}
