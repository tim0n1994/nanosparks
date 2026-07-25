'use client';

import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  /** Hide the label visually but keep it for screen readers. */
  labelHidden?: boolean;
  hint?: ReactNode;
  error?: string | null;
  /** Rendered inside the input frame, on the right (e.g. a submit button). */
  trailing?: ReactNode;
}

/**
 * Labelled input with the error text wired to the control via
 * aria-describedby + aria-invalid. Placeholders are not labels.
 */
export default function Field({
  label,
  labelHidden,
  hint,
  error,
  trailing,
  className,
  ...props
}: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ');

  return (
    <div className="w-full">
      <label
        htmlFor={id}
        className={cn(
          'mb-1.5 block text-sm font-medium text-ink',
          labelHidden && 'sr-only',
        )}
      >
        {label}
      </label>

      <div
        className={cn(
          'flex items-center rounded-xl border bg-surface-raised shadow-sm transition-shadow',
          'focus-within:ring-1 focus-within:ring-accent-200 focus-within:shadow-md',
          error ? 'border-red-400 focus-within:border-red-500' : 'border-line focus-within:border-accent-400',
        )}
      >
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={cn(
            'min-w-0 flex-1 bg-transparent px-4 py-3 text-base text-ink',
            'placeholder:text-ink-muted focus:outline-none focus-visible:ring-0 disabled:opacity-50',
            className,
          )}
          {...props}
        />
        {trailing}
      </div>

      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-xs text-red-600">
          {error}
        </p>
      )}
      {hint && !error && (
        <p id={hintId} className="mt-1.5 text-xs text-ink-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
