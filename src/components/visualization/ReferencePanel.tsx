'use client';

import { ReferenceLink } from '@/types/analysis';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface ReferencePanelProps {
  references: ReferenceLink[];
}

function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export default function ReferencePanel({ references }: ReferencePanelProps) {
  const { t } = useTranslation();
  const sortedRefs = [...references].sort((a, b) => b.relevanceScore - a.relevanceScore);

  const getScoreColor = (score: number): string => {
    if (score >= 0.9) return 'bg-green-100 text-green-800';
    if (score >= 0.8) return 'bg-blue-100 text-blue-800';
    if (score >= 0.7) return 'bg-yellow-100 text-yellow-800';
    return 'bg-surface-sunken text-ink';
  };

  return (
    <div className="bg-surface-raised rounded-lg border border-line overflow-hidden">
      <div className="px-4 py-3 border-b border-line-soft">
        <h3 className="font-semibold text-ink">{t('viz.references')}</h3>
        <p className="text-xs text-ink-muted mt-0.5">{t('viz.referencesDesc')}</p>
      </div>
      <div className="divide-y divide-line-soft max-h-[400px] overflow-y-auto">
        {sortedRefs.filter((ref) => isSafeUrl(ref.url)).map((ref) => (
          <a
            key={ref.id}
            href={ref.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block px-4 py-3 hover:bg-surface-sunken transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <h4 className="truncate text-sm font-medium text-link">
                  {ref.title}
                </h4>
                {ref.description && (
                  <p className="text-xs text-ink-muted mt-0.5 line-clamp-2">
                    {ref.description}
                  </p>
                )}
                <p className="text-xs text-ink-muted mt-1 truncate">{ref.url}</p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${getScoreColor(ref.relevanceScore)}`}>
                {Math.round(ref.relevanceScore * 100)}%
              </span>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
