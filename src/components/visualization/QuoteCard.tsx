'use client';

import { Quote, Speaker } from '@/types/analysis';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface QuoteCardProps {
  quote: Quote;
  speaker: Speaker;
}

export default function QuoteCard({ quote, speaker }: QuoteCardProps) {
  const { t } = useTranslation();
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(`"${quote.text}" — ${speaker.name}`);
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start gap-3">
        <div
          className="w-3 h-3 rounded-full mt-2 flex-shrink-0"
          style={{ backgroundColor: speaker.color }}
        />
        <div className="flex-1 min-w-0">
          <blockquote className="text-gray-900 font-medium text-sm leading-relaxed mb-2">
            &ldquo;{quote.text}&rdquo;
          </blockquote>
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>{speaker.name} · {formatTime(quote.timestamp)}</span>
            <button
              onClick={handleCopy}
              className="text-primary-600 hover:text-primary-700 font-medium"
            >
              {t('viz.copy')}
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1">{quote.context}</p>
        </div>
      </div>
    </div>
  );
}
