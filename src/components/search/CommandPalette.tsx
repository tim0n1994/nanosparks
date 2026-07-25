'use client';

/**
 * V2/T-V2-9: Cmd+K command palette.
 *
 * Global typeahead over four result kinds (集 / 人物 / 概念 / 金句) from
 * /api/search. Opens on Cmd/Ctrl+K or the nav search button, keyboard-navigable
 * (↑/↓/Enter/Esc), and navigates via the Next router so the SPA shell survives.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { OPEN_SEARCH_EVENT } from './openSearch';
import { Spinner } from '@/components/ui/Button';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface SearchItem {
  id: string;
  label: string;
  href: string;
  corpusId?: string;
}
interface SearchGroup {
  type: 'conversation' | 'person' | 'concept' | 'quote';
  items: SearchItem[];
}

export default function CommandPalette() {
  const router = useRouter();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Element to restore focus to when the palette closes (WCAG 2.4.3).
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // Reset lives on the open path, not in an effect, so opening does not cause a
  // second render pass just to clear the previous query.
  const openPalette = useCallback(() => {
    setQuery('');
    setGroups([]);
    setActiveIdx(0);
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    setOpen(true);
  }, []);

  const closePalette = useCallback(() => setOpen(false), []);

  // Global Cmd/Ctrl+K toggle + the nav button's event.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((wasOpen) => {
          if (wasOpen) return false;
          setQuery('');
          setGroups([]);
          setActiveIdx(0);
          restoreFocusRef.current = document.activeElement as HTMLElement | null;
          return true;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_SEARCH_EVENT, openPalette);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_SEARCH_EVENT, openPalette);
    };
  }, [openPalette]);

  // Focus, background scroll lock, and focus restoration on close.
  useEffect(() => {
    if (!open) {
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
      return;
    }
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  // Debounced search. An empty query is handled by deriving `visibleGroups`
  // below rather than clearing state from inside the effect.
  useEffect(() => {
    if (!open || query.trim().length < 1) return;
    const controller = new AbortController();
    // The spinner flips on when the debounce actually fires, so a fast typist
    // never sees it strobe once per keystroke.
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        const json = await res.json();
        setGroups(Array.isArray(json.data?.results) ? json.data.results : []);
        setActiveIdx(0);
      } catch {
        setGroups([]);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, open]);

  // Stale results must not survive the query being cleared — derive, don't clear.
  const visibleGroups = query.trim().length > 0 ? groups : [];
  const flat = visibleGroups.flatMap((g) => g.items.map((i) => ({ ...i, type: g.type })));

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closePalette();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => Math.min(flat.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const sel = flat[activeIdx];
        if (sel) go(sel.href);
      } else if (e.key === 'Tab') {
        // Single-input dialog: keep focus inside rather than escaping to the page.
        e.preventDefault();
      }
    },
    [flat, activeIdx, go, closePalette],
  );

  // Keep the highlighted row in view during arrow navigation.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  if (!open) return null;

  let runningIdx = 0;
  const activeId = flat[activeIdx] ? `cmdk-opt-${activeIdx}` : undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]"
      onClick={closePalette}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('nav.search')}
        className="w-full max-w-xl overflow-hidden rounded-xl border border-line bg-surface-raised shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('search.placeholder')}
          aria-label={t('search.label')}
          role="combobox"
          aria-expanded={flat.length > 0}
          aria-controls="cmdk-list"
          aria-activedescendant={activeId}
          autoComplete="off"
          className="w-full border-b border-line-soft bg-transparent px-4 py-3 text-base text-ink outline-none placeholder:text-ink-muted focus-visible:ring-0"
        />
        <div
          id="cmdk-list"
          ref={listRef}
          role="listbox"
          aria-label={t('search.results')}
          className="max-h-[50vh] overflow-y-auto p-2"
        >
          {loading && (
            <div className="flex justify-center px-3 py-4 text-ink-muted">
              <Spinner />
            </div>
          )}
          {!loading && flat.length === 0 && query.trim().length > 0 && (
            <p className="px-3 py-4 text-center text-xs text-ink-muted">{t('search.empty')}</p>
          )}
          {visibleGroups.map((g) => {
            if (g.items.length === 0) return null;
            return (
              <div key={g.type} className="mb-1" role="group" aria-label={t(`search.type.${g.type}`)}>
                <div className="px-3 py-1 text-2xs font-semibold uppercase tracking-wide text-ink-muted">
                  {t(`search.type.${g.type}`)}
                </div>
                {g.items.map((item) => {
                  const idx = runningIdx++;
                  const active = idx === activeIdx;
                  return (
                    <div
                      key={item.id}
                      id={`cmdk-opt-${idx}`}
                      data-idx={idx}
                      role="option"
                      aria-selected={active}
                      onMouseEnter={() => setActiveIdx(idx)}
                      onClick={() => go(item.href)}
                      className={`flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm ${
                        active ? 'bg-surface-sunken text-ink' : 'text-ink-subtle'
                      }`}
                    >
                      <span className="flex-1 truncate">{item.label}</span>
                      {/* V2/T-V2-9 §2.3: 搜索↔图联动 — jump to the corpus graph */}
                      {item.corpusId && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            go(`/corpora/${item.corpusId}/graph`);
                          }}
                          className="shrink-0 rounded bg-surface-sunken px-1.5 py-0.5 text-2xs text-ink-muted hover:text-ink"
                          aria-label={t('search.viewInGraph', { label: item.label })}
                        >
                          {t('search.graphShort')}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
