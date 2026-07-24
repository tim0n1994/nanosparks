'use client';

/**
 * V2/T-V2-9: Cmd+K command palette.
 *
 * Global typeahead over four result kinds (集 / 人物 / 概念 / 金句) from
 * /api/search. Opens on Cmd/Ctrl+K, keyboard-navigable (↑/↓/Enter/Esc), and
 * navigates to the selected result's href. Debounced to avoid spamming the API.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

interface SearchItem {
  id: string;
  label: string;
  href: string;
}
interface SearchGroup {
  type: 'conversation' | 'person' | 'concept' | 'quote';
  items: SearchItem[];
}

const TYPE_LABELS: Record<SearchGroup['type'], string> = {
  conversation: '集',
  person: '人物',
  concept: '概念',
  quote: '金句',
};

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global Cmd/Ctrl+K toggle.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Focus + reset on open.
  useEffect(() => {
    if (open) {
      setQuery('');
      setGroups([]);
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Debounced search.
  useEffect(() => {
    if (!open || query.trim().length < 1) {
      setGroups([]);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const json = await res.json();
        setGroups(Array.isArray(json.data?.results) ? json.data.results : []);
        setActiveIdx(0);
      } catch {
        setGroups([]);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [query, open]);

  const flat = groups.flatMap((g) => g.items.map((i) => ({ ...i, type: g.type })));

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => Math.min(flat.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        const sel = flat[activeIdx];
        if (sel) {
          window.location.href = sel.href;
        }
      }
    },
    [flat, activeIdx],
  );

  if (!open) return null;

  let runningIdx = 0;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-[12vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="搜索 集 / 人物 / 概念 / 金句…"
          className="w-full border-b border-zinc-100 px-4 py-3 text-sm outline-none placeholder:text-zinc-400"
        />
        <div className="max-h-[50vh] overflow-y-auto p-2">
          {loading && <div className="px-3 py-4 text-center text-xs text-zinc-400">…</div>}
          {!loading && flat.length === 0 && query.trim().length > 0 && (
            <div className="px-3 py-4 text-center text-xs text-zinc-400">无结果</div>
          )}
          {groups.map((g) => {
            if (g.items.length === 0) return null;
            return (
              <div key={g.type} className="mb-1">
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                  {TYPE_LABELS[g.type]}
                </div>
                {g.items.map((item) => {
                  const idx = runningIdx++;
                  const active = idx === activeIdx;
                  return (
                    <a
                      key={item.id}
                      href={item.href}
                      onMouseEnter={() => setActiveIdx(idx)}
                      className={`block truncate rounded-md px-3 py-2 text-sm ${
                        active ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-600'
                      }`}
                    >
                      {item.label}
                    </a>
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
