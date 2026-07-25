'use client';

interface TopicNode {
  id: string;
  name: string;
  mentionCount: number;
  sentiment: 'positive' | 'neutral' | 'negative';
}

interface ArgNode {
  id: string;
  text: string;
  speakerId: string;
  type: string;
  parentId?: string;
}

interface MindmapTreeProps {
  topics: TopicNode[];
  arguments: ArgNode[];
  speakerNames: Record<string, string>;
}

function getTypeEmoji(type: string): string {
  return type === 'claim' ? '💡' : type === 'support' ? '👍' : type === 'oppose' ? '⚡' : type === 'refine' ? '🔬' : '•';
}

export default function MindmapTree({ topics, arguments: args, speakerNames }: MindmapTreeProps) {
  // Group arguments by which topic's timestamps they fall into
  // Simplified: just show topic → related arguments flat tree
  const rootArgs = args.filter((a) => !a.parentId);

  return (
    <div className="bg-surface-raised rounded-lg border border-line overflow-hidden">
      <div className="px-4 py-3 border-b border-line-soft bg-surface-sunken">
        <h3 className="font-semibold text-ink text-sm">思维导图</h3>
      </div>
      <div className="p-4 space-y-4 max-h-[600px] overflow-y-auto">
        {topics.map((topic) => {
          // Find arguments whose text mentions the topic (fuzzy)
          const relatedArgs = args.filter((a) => a.text.includes(topic.name.slice(0, 2)));
          if (relatedArgs.length === 0) return null;

          return (
            <div key={topic.id}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-semibold text-ink">{topic.name}</span>
                <span className="text-xs text-ink-muted">({topic.mentionCount})</span>
              </div>
              <div className="ml-4 space-y-1 border-l-2 border-line-soft pl-3">
                {relatedArgs.slice(0, 5).map((arg) => (
                  <div key={arg.id} className="flex items-start gap-1.5 text-sm text-ink-subtle">
                    <span className="text-xs">{getTypeEmoji(arg.type)}</span>
                    <span>{arg.text.slice(0, 60)}{arg.text.length > 60 ? '…' : ''}</span>
                  </div>
                ))}
                {relatedArgs.length > 5 && (
                  <p className="text-xs text-ink-muted">+{relatedArgs.length - 5} 条</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
