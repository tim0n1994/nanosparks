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
    if (type === 'claim') return 'text-gray-900';
    if (type === 'support') return 'text-green-600';
    if (type === 'oppose') return 'text-red-600';
    if (type === 'refine') return 'text-blue-600';
    return 'text-gray-500';
  };

  const renderArgument = (arg: Argument, depth: number = 0) => {
    const speaker = getSpeaker(arg.speakerId);
    const children = args.filter((a) => a.parentId === arg.id);

    return (
      <div key={arg.id} className={depth > 0 ? 'ml-6 border-l-2 border-gray-100 pl-4' : ''}>
        <div className="flex items-start gap-2 py-2">
          <span className={`text-sm ${getTypeColor(arg.type)}`}>{getTypeIcon(arg.type)}</span>
          <div className="flex-1">
            <p className="text-sm text-gray-800">{arg.text}</p>
            <div className="flex items-center gap-2 mt-1">
              {speaker && (
                <span className="text-xs text-gray-500 flex items-center gap-1">
                  <span
                    className="w-2 h-2 rounded-full inline-block"
                    style={{ backgroundColor: speaker.color }}
                  />
                  {speaker.name}
                </span>
              )}
              <span className="text-xs text-gray-400">
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
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h3 className="font-semibold text-gray-900 mb-3">{t('viz.argumentThreads')}</h3>
      <div className="space-y-2">
        {rootArgs.map((arg) => renderArgument(arg))}
      </div>
    </div>
  );
}
