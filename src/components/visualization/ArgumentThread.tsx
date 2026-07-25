'use client';

import { Argument, Speaker } from '@/types/analysis';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface ArgumentThreadProps {
  arguments: Argument[];
  speakers: Speaker[];
  rootId?: string;
}

export default function ArgumentThread({ arguments: args, speakers, rootId }: ArgumentThreadProps) {
  const { t } = useTranslation();
  const rootArgs = rootId
    ? args.filter((a) => a.id === rootId)
    : args.filter((a) => !a.parentId);

  const getSpeaker = (speakerId: string) => speakers.find((s) => s.id === speakerId);

  const getTypeIcon = (type: string): string => {
    if (type === 'claim') return '●';
    if (type === 'support') return '↑';
    if (type === 'oppose') return '↓';
    if (type === 'refine') return '↻';
    return '○';
  };

  const getTypeColor = (type: string): string => {
    if (type === 'claim') return 'text-ink';
    if (type === 'support') return 'text-emerald-600 dark:text-emerald-400';
    if (type === 'oppose') return 'text-red-600';
    if (type === 'refine') return 'text-blue-600';
    return 'text-ink-muted';
  };

  const renderArgument = (arg: Argument, depth: number = 0) => {
    const speaker = getSpeaker(arg.speakerId);
    const children = args.filter((a) => a.parentId === arg.id);

    return (
      <div key={arg.id} className={depth > 0 ? 'ml-6 border-l-2 border-line-soft pl-4' : ''}>
        <div className="flex items-start gap-2 py-2">
          <span className={`text-sm ${getTypeColor(arg.type)}`}>{getTypeIcon(arg.type)}</span>
          <div className="flex-1">
            <p className="text-sm text-ink">{arg.text}</p>
            <div className="flex items-center gap-2 mt-1">
              {speaker && (
                <span className="text-xs text-ink-muted flex items-center gap-1">
                  <span
                    className="w-2 h-2 rounded-full inline-block"
                    style={{ backgroundColor: speaker.color }}
                  />
                  {speaker.name}
                </span>
              )}
              <span className="text-xs text-ink-muted">
                {Math.floor(arg.timestamp / 60)}:{(arg.timestamp % 60).toString().padStart(2, '0')}
              </span>
            </div>
          </div>
        </div>
        {children.map((child) => renderArgument(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="bg-surface-raised rounded-lg border border-line p-4">
      <h3 className="font-semibold text-ink mb-3">{t('viz.argumentThreads')}</h3>
      <div className="space-y-2">
        {rootArgs.map((arg) => renderArgument(arg))}
      </div>
    </div>
  );
}
