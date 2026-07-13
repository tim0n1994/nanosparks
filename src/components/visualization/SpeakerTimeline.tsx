'use client';

import { Speaker, Topic } from '@/types/analysis';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface SpeakerTimelineProps {
  speakers: Speaker[];
  topics: Topic[];
  duration: number;
}

export default function SpeakerTimeline({ speakers, topics, duration }: SpeakerTimelineProps) {
  const { t } = useTranslation();
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    return `${mins}m`;
  };

  const getTopicColor = (topicName: string): string => {
    const topic = topics.find((t) => t.name === topicName);
    if (!topic) return '#9ca3af';
    if (topic.sentiment === 'positive') return '#22c55e';
    if (topic.sentiment === 'negative') return '#ef4444';
    return '#6b7280';
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h3 className="font-semibold text-gray-900 mb-4">{t('viz.speakerTimeline')}</h3>
      <div className="space-y-3">
        {speakers.map((speaker) => (
          <div key={speaker.id} className="flex items-center gap-3">
            <div className="w-24 flex-shrink-0">
              <div className="flex items-center gap-1.5">
                <div
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: speaker.color }}
                />
                <span className="text-xs font-medium text-gray-700 truncate">
                  {speaker.name}
                </span>
              </div>
            </div>
            <div className="flex-1 relative h-6 bg-gray-100 rounded-full overflow-hidden">
              {topics.map((topic) =>
                topic.timestamps.map((ts, idx) => (
                  <div
                    key={`${topic.id}-${idx}`}
                    className="absolute top-0 h-full rounded-full opacity-60"
                    style={{
                      left: `${(ts / duration) * 100}%`,
                      width: `${(topic.mentionCount * 2 / duration) * 100}%`,
                      backgroundColor: getTopicColor(topic.name),
                    }}
                    title={`${topic.name} @ ${formatTime(ts)}`}
                  />
                ))
              )}
            </div>
            <span className="text-xs text-gray-500 w-12 text-right">
              {formatTime(speaker.speakingTime)}
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-4 mt-4 text-xs text-gray-500">
        {topics.map((topic) => (
          <div key={topic.id} className="flex items-center gap-1">
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: getTopicColor(topic.name) }}
            />
            <span>{topic.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
