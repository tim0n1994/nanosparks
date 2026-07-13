'use client';

interface KeywordsBarProps {
  topics: Array<{ id: string; name: string; mentionCount: number; sentiment: string }>;
  onTopicClick?: (topicId: string) => void;
}

const SENTIMENT_COLORS: Record<string, string> = {
  positive: 'bg-green-50 text-green-700 border-green-200',
  neutral: 'bg-gray-50 text-gray-700 border-gray-200',
  negative: 'bg-red-50 text-red-700 border-red-200',
};

export default function KeywordsBar({ topics, onTopicClick }: KeywordsBarProps) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
        <h3 className="font-semibold text-gray-900 text-sm">关键词</h3>
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
