'use client';

/**
 * Highlight library (C2) — the list of saved highlights for the open episode.
 *
 * The reader already lets you CREATE highlights (划句 → floating button), but
 * never showed what you'd saved. This panel lists them, jumps back to the
 * source turn on click, and offers a one-tap quote-card download (B1 renderer,
 * server-rendered PNG via /api/highlights/:id/card?format=png).
 *
 * Re-fetches when `refreshKey` changes so a newly-created highlight appears
 * without a full page reload.
 */

import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from '@/lib/i18n/useTranslation';
import Collapsible from '@/components/ui/Collapsible';

interface Highlight {
  id: string;
  note: string | null;
  startOffset: number;
  endOffset: number;
  createdAt: string;
  turn: {
    id: string;
    text: string;
    turnIndex: number;
    startMs: number;
    participant: { name: string | null } | null;
  } | null;
}

interface Props {
  conversationId: string;
  /** Bump to trigger a refetch (e.g. after creating a highlight). */
  refreshKey: number;
  /** Called when the user clicks a highlight — host scrolls to the turn. */
  onJump?: (turnId: string) => void;
}

function fmtMs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

export default function HighlightLibrary({ conversationId, refreshKey, onJump }: Props) {
  const { t } = useTranslation();
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/conversations/${conversationId}/highlights`);
      if (res.ok) {
        const data = await res.json();
        setHighlights(Array.isArray(data.highlights) ? data.highlights : []);
      }
    } catch {
      /* supplementary — silent */
    } finally {
      setLoaded(true);
    }
  }, [conversationId]);

  // Reload when a new highlight is created (open-triggered load is via onToggle).
  useEffect(() => { if (refreshKey > 0) load(); }, [refreshKey, load]);

  const count = highlights.length;

  return (
    <Collapsible
      title={
        <>
          {t('reader.highlightLibrary')}
          {count > 0 && <span className="ml-2 text-ink-muted">({count})</span>}
        </>
      }
      onToggle={(o) => { if (o) load(); }}
    >
      {!loaded ? (
        <p className="text-sm text-ink-muted">…</p>
      ) : count === 0 ? (
        <p className="text-sm text-ink-muted">{t('reader.highlightEmpty')}</p>
      ) : (
        <ul className="space-y-2.5">
          {highlights.map((h) => {
            const text = h.note || (h.turn ? h.turn.text.slice(h.startOffset, h.endOffset || undefined) : '');
            const speaker = h.turn?.participant?.name;
            const ts = h.turn?.startMs;
            return (
              <li key={h.id} className="rounded-lg border border-line-soft bg-surface p-3">
                <p className="text-sm leading-relaxed text-ink line-clamp-3">{text}</p>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-ink-muted">
                  {speaker && <span>· {speaker}</span>}
                  {ts != null && <span className="font-mono">{fmtMs(ts)}</span>}
                  {h.turn && onJump && (
                    <button
                      type="button"
                      onClick={() => onJump(h.turn!.id)}
                      className="font-medium text-link hover:underline"
                    >
                      {t('reader.highlightJump')}
                    </button>
                  )}
                  <a
                    href={`/api/highlights/${h.id}/card?format=png`}
                    download
                    className="font-medium text-link hover:underline"
                  >
                    {t('reader.quoteCard')}
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Collapsible>
  );
}
