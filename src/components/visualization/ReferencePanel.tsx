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
    return 'bg-gray-100 text-gray-800';
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100">
        <h3 className="font-semibold text-gray-900">{t('viz.references')}</h3>
        <p className="text-xs text-gray-500 mt-0.5">{t('viz.referencesDesc')}</p>
      </div>
      <div className="divide-y divide-gray-100 max-h-[400px] overflow-y-auto">
        {sortedRefs.filter((ref) => isSafeUrl(ref.url)).map((ref) => (
          <a
            key={ref.id}
            href={ref.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block px-4 py-3 hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-medium text-primary-600 truncate">
                  {ref.title}
                </h4>
                {ref.description && (
                  <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                    {ref.description}
                  </p>
                )}
                <p className="text-xs text-gray-400 mt-1 truncate">{ref.url}</p>
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
