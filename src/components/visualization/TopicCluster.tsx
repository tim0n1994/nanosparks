'use client';

import { Topic } from '@/types/analysis';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface TopicClusterProps {
  topics: Topic[];
  onTopicClick?: (topicId: string) => void;
}

export default function TopicCluster({ topics, onTopicClick }: TopicClusterProps) {
  const { t } = useTranslation();
  const maxCount = topics.length > 0 ? Math.max(...topics.map((t) => t.mentionCount)) : 1;

  const getSentimentColor = (sentiment: string): string => {
    if (sentiment === 'positive') return '#22c55e';
    if (sentiment === 'negative') return '#ef4444';
    return '#6b7280';
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h3 className="font-semibold text-gray-900 mb-4">{t('viz.topics')}</h3>
      <div className="flex flex-wrap gap-3">
        {topics.map((topic) => {
          const size = 40 + (topic.mentionCount / maxCount) * 60;
          return (
            <button
              key={topic.id}
              onClick={() => onTopicClick?.(topic.id)}
              className="rounded-full flex items-center justify-center text-white font-medium text-xs hover:scale-110 transition-transform cursor-pointer"
              style={{
                width: size,
                height: size,
                backgroundColor: getSentimentColor(topic.sentiment),
                opacity: 0.7 + (topic.mentionCount / maxCount) * 0.3,
              }}
              title={`${topic.name}: ${topic.mentionCount} mentions`}
            >
              <span className="px-2 text-center leading-tight">{topic.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
