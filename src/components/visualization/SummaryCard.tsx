'use client';

import { useTranslation } from '@/lib/i18n/useTranslation';

interface SummaryData {
  summary: string;
  takeaways: string[];
  language: string;
  host?: string;
}

interface SummaryCardProps {
  data: SummaryData;
}

export default function SummaryCard({ data }: SummaryCardProps) {
  const { t } = useTranslation();

  return (
    <div className="bg-surface-raised rounded-lg border border-line overflow-hidden">
      <div className="px-4 py-3 border-b border-line-soft bg-surface-sunken">
        <h3 className="font-semibold text-ink text-sm">AI 摘要</h3>
      </div>
      <div className="p-4">
        <p className="text-sm text-ink-subtle leading-relaxed mb-4">{data.summary}</p>
        {data.takeaways.length > 0 && (
          <div>
            <h4 className="text-xs font-medium text-ink-muted uppercase tracking-wide mb-2">核心要点</h4>
            <ul className="space-y-2">
              {data.takeaways.map((tw, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-ink-subtle">
                  <span className="text-accent-500 mt-0.5">•</span>
                  <span>{tw}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {data.host && (
          <p className="text-xs text-ink-muted mt-3">主持人：{data.host}</p>
        )}
      </div>
    </div>
  );
}
