'use client';

import { useId } from 'react';
import { useTranslation } from '@/lib/i18n/useTranslation';

type SearchMode = 'keyword' | 'semantic' | 'hybrid';

interface SearchModeSelectorProps {
  mode: SearchMode;
  onChange: (mode: SearchMode) => void;
}

const MODES: readonly SearchMode[] = ['keyword', 'semantic', 'hybrid'];

/**
 * A real radiogroup. Previously three plain <button>s with no aria-pressed, so
 * assistive tech announced "button" three times and never said which was on.
 */
export default function SearchModeSelector({ mode, onChange }: SearchModeSelectorProps) {
  const { t } = useTranslation();
  const labelId = useId();

  const move = (delta: number) => {
    const i = MODES.indexOf(mode);
    onChange(MODES[(i + delta + MODES.length) % MODES.length]);
  };

  return (
    <div>
      <p id={labelId} className="section-label mb-2">
        {t('query.modeLabel')}
      </p>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className="grid gap-2 sm:grid-cols-3"
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            e.preventDefault();
            move(1);
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault();
            move(-1);
          }
        }}
      >
        {MODES.map((value) => {
          const isActive = mode === value;
          const label = t(`query.mode.${value}`);
          const description = t(`query.mode.${value}Desc`);
          const badge = value === 'hybrid' ? t('query.modeRec') : undefined;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onChange(value)}
              className={`rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                isActive
                  ? 'border-accent-400 bg-accent-500/10'
                  : 'border-line bg-surface-raised hover:border-ink-muted'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <span className={`font-medium ${isActive ? 'text-accent-700 dark:text-accent-300' : 'text-ink-subtle'}`}>
                  {label}
                </span>
                {badge && (
                  <span
                    className={`rounded px-1.5 py-0.5 text-2xs font-semibold uppercase ${
                      isActive ? 'bg-accent-500/20 text-accent-700 dark:text-accent-300' : 'bg-surface-sunken text-ink-muted'
                    }`}
                  >
                    {badge}
                  </span>
                )}
              </span>
              <span className="mt-0.5 block text-2xs leading-tight text-ink-muted">
                {description}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
