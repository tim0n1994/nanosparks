'use client';

interface KeywordsBarProps {
  topics: Array<{ id: string; name: string; mentionCount: number; sentiment: string }>;
  onTopicClick?: (topicId: string) => void;
}

const SENTIMENT_COLORS: Record<string, string> = {
  positive: 'bg-green-50 text-green-700 border-green-200',
  neutral: 'bg-surface-sunken text-ink-subtle border-line',
  negative: 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30',
};

export default function KeywordsBar({ topics, onTopicClick }: KeywordsBarProps) {
  return (
    <div className="bg-surface-raised rounded-lg border border-line overflow-hidden">
      <div className="px-4 py-3 border-b border-line-soft bg-surface-sunken">
        <h3 className="font-semibold text-ink text-sm">关键词</h3>
      </div>
      <div className="p-4 flex flex-wrap gap-2">
        {topics.map((topic) => (
          <button
            key={topic.id}
            onClick={() => onTopicClick?.(topic.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors hover:opacity-80 ${SENTIMENT_COLORS[topic.sentiment] || SENTIMENT_COLORS.neutral}`}
          >
            {topic.name}
            <span className="ml-1 opacity-60">{topic.mentionCount}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
