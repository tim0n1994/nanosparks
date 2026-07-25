import { statusView, TONE_CLASS } from '@/lib/status';
import { cn } from '@/lib/utils';

interface StatusBadgeProps {
  status: string | null | undefined;
  lang?: 'zh' | 'en';
  className?: string;
}

/** Status pill. Reads the single vocabulary in lib/status — no local label maps. */
export default function StatusBadge({ status, lang = 'zh', className }: StatusBadgeProps) {
  const view = statusView(status);
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-medium',
        TONE_CLASS[view.tone],
        className,
      )}
    >
      {lang === 'zh' ? view.label : view.labelEn}
    </span>
  );
}
