'use client';

import { useState } from 'react';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface Segment {
  start: number;
  end: number;
  text: string;
  speakerId?: string;
  speakerName?: string;
}

interface TranscriptPanelProps {
  segments: Segment[];
  speakerColors: Record<string, string>;
  speakerNames?: Record<string, string>;
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function TranscriptPanel({ segments, speakerColors, speakerNames }: TranscriptPanelProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');

  if (!segments || segments.length === 0) {
    return (
      <div className="bg-surface-raised rounded-lg border border-line p-6 text-center text-ink-muted">
        {t('viz.noData')}
      </div>
    );
  }

  const filtered = search.trim()
    ? segments.filter((s) => s.text.toLowerCase().includes(search.toLowerCase()))
    : segments;

  return (
    <div className="bg-surface-raised rounded-lg border border-line overflow-hidden">
      {/* Header with search */}
      <div className="px-4 py-3 border-b border-line-soft bg-surface-sunken flex items-center justify-between gap-3">
        <h3 className="font-semibold text-ink text-sm flex-shrink-0">转录</h3>
        <div className="flex-1 max-w-xs">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('viz.searchTranscript')}
            className="w-full text-xs px-2.5 py-1.5 border border-line rounded-md focus:outline-none focus:border-accent-400 focus:ring-1 focus:ring-accent-400"
          />
        </div>
        <span className="text-xs text-ink-muted flex-shrink-0">{filtered.length} 段</span>
      </div>

      {/* Transcript body */}
      <div className="max-h-[calc(100vh-220px)] overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="p-6 text-center text-sm text-ink-muted">无匹配内容</div>
        ) : (
          <div>
            {filtered.map((seg, i) => {
              const speakerColor = seg.speakerId
                ? speakerColors[seg.speakerId] || '#6b7280'
                : '#6b7280';
              const speakerName = seg.speakerName || (seg.speakerId
                ? (speakerNames?.[seg.speakerId] || seg.speakerId.replace(/^speaker_/, t('viz.speakerPrefix')))
                : '');

              return (
                <div key={i} className="px-4 py-3 hover:bg-surface-sunken/50 group transition-colors border-b border-line-soft last:border-b-0">
                  {/* Speaker + Timestamp line */}
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: speakerColor }}
                    />
                    {speakerName && (
                      <span className="text-xs font-semibold text-ink-subtle">{speakerName}</span>
                    )}
                    <span className="text-xs text-ink-muted tabular-nums">
                      [{formatTime(seg.start)}]
                    </span>
                  </div>

                  {/* Text */}
                  <p className="text-sm text-ink-subtle leading-relaxed ml-4.5">
                    {seg.text}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
