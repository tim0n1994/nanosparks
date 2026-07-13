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
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
        <h3 className="font-semibold text-gray-900 text-sm">AI 摘要</h3>
      </div>
      <div className="p-4">
        <p className="text-sm text-gray-700 leading-relaxed mb-4">{data.summary}</p>
        {data.takeaways.length > 0 && (
          <div>
            <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">核心要点</h4>
            <ul className="space-y-2">
              {data.takeaways.map((tw, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                  <span className="text-primary-500 mt-0.5">•</span>
                  <span>{tw}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {data.host && (
          <p className="text-xs text-gray-400 mt-3">主持人：{data.host}</p>
        )}
      </div>
    </div>
  );
}
