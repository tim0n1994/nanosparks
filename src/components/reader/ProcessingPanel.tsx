'use client';

import Link from 'next/link';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { ProgressDetail } from '@/lib/reader/useProgressStream';
import { cn } from '@/lib/utils';

/** Ordered pipeline stages. Single source of the reader-facing stage copy. */
export const STAGES = [
  'queued',
  'downloading',
  'transcribing',
  'diarizing',
  'extracting',
  'ready',
] as const;

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}:${r.toString().padStart(2, '0')}` : `${r}s`;
}

interface ProcessingPanelProps {
  detail: ProgressDetail | null;
  /** Live stage from SSE, or the server-rendered one before the first frame. */
  stage: ProgressDetail['stage'] | null;
  stalled: boolean;
  /** Progress to show until the first SSE frame arrives. */
  fallbackProgress: number;
  onRetry?: () => void;
  retrying?: boolean;
}

/**
 * The ~10 minute wait, designed.
 *
 * The old version was a static amber strip that never changed until the page
 * was reloaded. This one is live: it names the current stage, counts what has
 * actually been produced so far (段 / 要点), gives an ETA, and tells the user
 * they are free to leave. The transcript below it fills in underneath as
 * turns land, so the wait is progressive rather than binary.
 */
export default function ProcessingPanel({
  detail,
  stage,
  stalled,
  fallbackProgress,
  onRetry,
  retrying,
}: ProcessingPanelProps) {
  const { t } = useTranslation();
  const failed = stage === 'failed';
  const currentIndex = stage ? STAGES.indexOf(stage as (typeof STAGES)[number]) : -1;
  const progress = detail ? detail.progress : fallbackProgress;
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  // Label and hint come from the catalogue, not from the server's `detail.label`
  // — that field is Chinese-only, so switching to English used to leave the
  // stage name untranslated. The percentage it carried is shown here instead.
  const stageKey = currentIndex >= 0 ? STAGES[currentIndex] : 'queued';
  const label =
    stage === 'transcribing' && pct > 0
      ? `${t(`processing.stage.${stageKey}`)} ${pct}%`
      : t(`processing.stage.${stageKey}`);
  const hint = t(`processing.stage.${stageKey}Hint`);

  return (
    <section
      role="status"
      aria-live="polite"
      className={cn(
        'mt-4 rounded-xl border px-4 py-3.5',
        failed
          ? 'border-red-500/30 bg-red-500/10'
          : 'border-amber-500/30 bg-amber-500/10',
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span
          className={cn(
            'text-sm font-semibold',
            failed ? 'text-red-700 dark:text-red-300' : 'text-amber-800 dark:text-amber-200',
          )}
        >
          {failed ? t('processing.failed') : label}
        </span>
        <span className={cn('text-xs', failed ? 'text-red-600 dark:text-red-400' : 'text-amber-700 dark:text-amber-300')}>
          {failed ? t('processing.failedHint') : hint}
        </span>
        {stalled && !failed && (
          <span className="ml-auto font-mono text-2xs text-amber-700 dark:text-amber-400">
            {t('processing.reconnecting')}
          </span>
        )}
      </div>

      {!failed && (
        <>
          <div
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('processing.progressLabel')}
            className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-amber-500/20"
          >
            <div
              className="h-full rounded-full bg-amber-500 transition-all duration-700 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>

          {/* Momentum: what has actually been produced so far. */}
          {detail && (
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-2xs text-amber-700 dark:text-amber-400">
              <span>{t('processing.elapsed', { value: fmtDuration(detail.elapsedMs) })}</span>
              {detail.etaMs > 0 && <span>{t('processing.eta', { value: fmtDuration(detail.etaMs) })}</span>}
              {detail.turnCount > 0 && <span>{t('processing.turns', { count: detail.turnCount })}</span>}
              {detail.thoughtUnitCount > 0 && <span>{t('processing.units', { count: detail.thoughtUnitCount })}</span>}
            </div>
          )}

          {/* Stage rail — compact, so it informs without dominating the hero. */}
          <ol className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-2xs">
            {STAGES.map((key, i) => {
              const done = currentIndex > i;
              const active = currentIndex === i;
              return (
                <li
                  key={key}
                  aria-current={active ? 'step' : undefined}
                  className={cn(
                    'flex items-center gap-1',
                    active
                      ? 'font-medium text-amber-800 dark:text-amber-200'
                      : done
                        ? 'text-amber-600/70 dark:text-amber-400/70'
                        : 'text-amber-600/40 dark:text-amber-400/40',
                  )}
                >
                  <span aria-hidden="true">{done ? '✓' : active ? '›' : '·'}</span>
                  {t(`processing.stage.${key}`)}
                </li>
              );
            })}
          </ol>

          <p className="mt-2.5 text-xs text-amber-700 dark:text-amber-300">
            {t('processing.leaveHint')}
            <Link href="/dashboard" className="mx-1 underline underline-offset-2">
              {t('nav.shelf')}
            </Link>
            {t('processing.leaveHintTail')}
          </p>
        </>
      )}

      {failed && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="mt-3 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {retrying ? t('processing.retrying') : t('processing.retry')}
        </button>
      )}
    </section>
  );
}
