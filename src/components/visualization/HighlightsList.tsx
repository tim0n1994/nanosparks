'use client';

interface Highlight {
  timestamp: number;
  text: string;
  speaker: string;
}

interface HighlightsListProps {
  highlights: Highlight[];
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function HighlightsList({ highlights }: HighlightsListProps) {
  if (highlights.length === 0) {
    return (
      <div className="bg-surface-raised rounded-lg border border-line overflow-hidden">
        <div className="px-4 py-3 border-b border-line-soft bg-surface-sunken">
          <h3 className="font-semibold text-ink text-sm">高亮时刻</h3>
        </div>
        <div className="p-4 text-sm text-ink-muted">暂无高亮</div>
      </div>
    );
  }

  return (
    <div className="bg-surface-raised rounded-lg border border-line overflow-hidden">
      <div className="px-4 py-3 border-b border-line-soft bg-surface-sunken">
        <h3 className="font-semibold text-ink text-sm">高亮时刻</h3>
      </div>
      <div className="divide-y divide-line-soft max-h-[500px] overflow-y-auto">
        {highlights.map((h, i) => (
          <div key={i} className="px-4 py-3 hover:bg-surface-sunken group transition-colors">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-ink-muted tabular-nums bg-surface-sunken px-1.5 py-0.5 rounded">
                {formatTime(h.timestamp)}
              </span>
              <span className="text-xs text-ink-muted">{h.speaker}</span>
            </div>
            <p className="text-sm text-ink-subtle leading-relaxed">{h.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
