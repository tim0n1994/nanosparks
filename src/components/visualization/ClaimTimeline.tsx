'use client';

/**
 * V3/T-V3-1: claim evolution timeline.
 *
 * Shows how a CanonicalClaim (or a person's claims) evolved over time — each
 * member ThoughtUnit sorted by its conversation/evidence timestamp. Clicking a
 * row navigates to the reader at that conversation. Pure presentational; the
 * data comes from the Person Hub API or a claim detail endpoint.
 */

interface TimelineEntry {
  claimId: string;
  text: string;
  assertedAt: string | null; // ISO
  conversationId: string | null;
  stance?: string | null;
  modality?: string | null;
  evidence?: { turnId: string | null; startMs: number; endMs: number; quote: string } | null;
  /** §3 trust algebra: product of attribution × traceability, with per-factor basis. */
  trust?: { score: number; factors: Array<{ stage: string; value: number; basis: string }> } | null;
}

interface Props {
  entries: TimelineEntry[];
  emptyHint?: string;
}

function fmt(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

/** Deep-link into the reader at a precise turn + timestamp (ms → seconds). */
function readerLink(conversationId: string, evidence?: TimelineEntry['evidence']): string {
  if (!evidence || !evidence.turnId) return `/read/${conversationId}`;
  const sec = Math.max(0, Math.floor(evidence.startMs / 1000));
  return `/read/${conversationId}?t=${sec}&turn=${evidence.turnId}`;
}

export default function ClaimTimeline({ entries, emptyHint }: Props) {
  if (entries.length === 0) {
    return <div className="py-6 text-center text-sm text-ink-muted">{emptyHint}</div>;
  }
  const sorted = [...entries].sort((a, b) => {
    const ta = a.assertedAt ? new Date(a.assertedAt).getTime() : 0;
    const tb = b.assertedAt ? new Date(b.assertedAt).getTime() : 0;
    return ta - tb;
  });

  return (
    <div className="relative pl-4">
      <div className="absolute bottom-0 left-[7px] top-1 w-px bg-surface-sunken" />
      <ul className="space-y-3">
        {sorted.map((e) => (
          <li key={e.claimId} className={`relative ${e.trust && e.trust.score < 0.5 ? 'opacity-60' : ''}`}>
            <span className="absolute -left-3.5 top-1.5 h-2 w-2 rounded-full bg-accent-500" />
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-2xs tabular-nums text-ink-muted">{fmt(e.assertedAt)}</span>
              <span className="flex items-center gap-1.5">
                {e.trust && (
                  <span
                    className={`rounded px-1 text-2xs tabular-nums ${e.trust.score < 0.5 ? 'bg-surface-sunken text-ink-muted' : 'text-ink-muted'}`}
                    title={e.trust.factors.map((f) => `${f.stage} ${f.value}: ${f.basis}`).join('\n')}
                  >
                    {e.trust.score < 0.5 ? `溯源弱 ${Math.round(e.trust.score * 100)}%` : `信任 ${Math.round(e.trust.score * 100)}%`}
                  </span>
                )}
                {e.stance && <span className="text-2xs uppercase tracking-wide text-ink-muted">{e.stance}</span>}
                {e.modality === 'quoted' && (
                  <span className="rounded bg-surface-sunken px-1 text-2xs text-ink-muted" title="host echoing — not their own stance">quoted</span>
                )}
              </span>
            </div>
            <p className="text-sm leading-relaxed text-ink">{e.text}</p>
            {e.evidence?.quote && (
              <p className="mt-1 border-l-2 border-line pl-2 text-xs italic leading-relaxed text-ink-subtle">
                &ldquo;{e.evidence.quote.slice(0, 140)}&rdquo;
              </p>
            )}
            {e.conversationId && (
              <a className="text-2xs font-medium text-link hover:underline" href={readerLink(e.conversationId, e.evidence)}>
                进阅读器 →
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
