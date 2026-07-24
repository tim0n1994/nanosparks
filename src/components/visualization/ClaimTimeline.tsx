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

export default function ClaimTimeline({ entries, emptyHint = '暂无时间线数据' }: Props) {
  if (entries.length === 0) {
    return <div className="py-6 text-center text-sm text-zinc-400">{emptyHint}</div>;
  }
  const sorted = [...entries].sort((a, b) => {
    const ta = a.assertedAt ? new Date(a.assertedAt).getTime() : 0;
    const tb = b.assertedAt ? new Date(b.assertedAt).getTime() : 0;
    return ta - tb;
  });

  return (
    <div className="relative pl-4">
      <div className="absolute bottom-0 left-[7px] top-1 w-px bg-zinc-200" />
      <ul className="space-y-3">
        {sorted.map((e) => (
          <li key={e.claimId} className="relative">
            <span className="absolute -left-3.5 top-1.5 h-2 w-2 rounded-full bg-accent-500" />
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] tabular-nums text-zinc-400">{fmt(e.assertedAt)}</span>
              {e.stance && <span className="text-[10px] uppercase tracking-wide text-zinc-400">{e.stance}</span>}
            </div>
            <p className="text-sm leading-relaxed text-zinc-800">{e.text}</p>
            {e.conversationId && (
              <a className="text-[11px] font-medium text-blue-600 hover:underline" href={`/read/${e.conversationId}`}>
                进阅读器 →
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
