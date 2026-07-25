'use client';

import { useRef } from 'react';
import { cn } from '@/lib/utils';

export interface Segment<T extends string> {
  value: T;
  label: string;
  /** Optional per-option style override (e.g. font-size preview swatches). */
  style?: React.CSSProperties;
  /** Accessible name when `label` is a glyph like "A" or "Aa". */
  srLabel?: string;
}

interface SegmentedControlProps<T extends string> {
  /** Group name announced by screen readers, e.g. "字号". */
  label: string;
  value: T;
  options: readonly Segment<T>[];
  onChange: (value: T) => void;
  className?: string;
  size?: 'sm' | 'md';
}

/**
 * A real radiogroup: arrow keys move between options, only the selected
 * option is in the tab order, and state is exposed via aria-checked.
 * Replaces the five hand-rolled "row of buttons" toggles in the app.
 */
export default function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
  size = 'sm',
}: SegmentedControlProps<T>) {
  const ref = useRef<HTMLDivElement>(null);

  const move = (delta: number) => {
    const i = options.findIndex((o) => o.value === value);
    const next = options[(i + delta + options.length) % options.length];
    onChange(next.value);
    // Keep focus on the newly-selected radio.
    requestAnimationFrame(() => {
      ref.current
        ?.querySelector<HTMLButtonElement>(`[data-seg="${next.value}"]`)
        ?.focus();
    });
  };

  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label={label}
      className={cn('inline-flex items-center gap-1', className)}
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
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            data-seg={opt.value}
            aria-checked={active}
            aria-label={opt.srLabel}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(opt.value)}
            style={opt.style}
            className={cn(
              'rounded-md font-medium transition-colors',
              size === 'sm' ? 'h-7 min-w-7 px-2.5 text-xs' : 'h-9 min-w-9 px-3 text-sm',
              active
                ? 'bg-ink text-surface-raised'
                : 'bg-surface-raised text-ink-muted border border-line hover:text-ink',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
