import { useState, type ReactNode } from 'react';

interface CollapsibleProps {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  /** Fired on open/close so the host can lazy-load content. */
  onToggle?: (open: boolean) => void;
}
/**
 * Collapsible section — the only expand/collapse chrome in the app.
 * Used by HighlightLibrary (reader) + CorpusMetaPanels (3 panels).
 * `title` is a ReactNode so callers can append count badges.
 */
export default function Collapsible({ title, children, defaultOpen = false, onToggle }: CollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="mt-4 rounded-xl border border-line bg-surface-raised">
      <button
        type="button"
        onClick={() => { setOpen((v) => { const n = !v; onToggle?.(n); return n; }); }}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold text-ink">{title}</span>
        <span className="text-ink-muted" aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      {open && <div className="border-t border-line-soft px-4 py-3">{children}</div>}
    </section>
  );
}
