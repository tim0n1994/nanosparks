'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PopoverProps {
  /** Content of the trigger button. */
  trigger: ReactNode;
  /** Accessible name for the trigger when its content is a glyph. */
  triggerLabel?: string;
  children: ReactNode;
  /** Which edge of the trigger the panel aligns to. */
  align?: 'start' | 'end';
  className?: string;
  panelClassName?: string;
}

/**
 * Click-to-open overlay panel: closes on Escape, on outside click, and returns
 * focus to the trigger.
 *
 * Exists so the reader toolbar can stay one row high. The previous inline
 * expansion pushed the transcript down every time the user opened font
 * settings, and the horizontally-scrolling chapter strip ate a whole row on
 * a phone.
 */
export default function Popover({
  trigger,
  triggerLabel,
  children,
  align = 'start',
  className,
  panelClassName,
}: PopoverProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-haspopup="dialog"
        aria-label={triggerLabel}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex h-8 items-center gap-1 whitespace-nowrap rounded-md border px-2.5 text-sm font-medium transition-colors',
          open
            ? 'border-ink-muted bg-surface-sunken text-ink'
            : 'border-line text-ink-muted hover:border-ink-muted hover:text-ink',
        )}
      >
        {trigger}
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label={triggerLabel}
          className={cn(
            'absolute top-full z-30 mt-1.5 min-w-48 rounded-xl border border-line bg-surface-raised p-2 shadow-lg',
            align === 'end' ? 'right-0' : 'left-0',
            panelClassName,
          )}
          // Selecting an item closes the panel; the reader's items are links
          // and buttons that all act immediately.
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('[data-popover-close]')) setOpen(false);
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
