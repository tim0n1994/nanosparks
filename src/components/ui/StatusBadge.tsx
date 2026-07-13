import { EpisodeStatus } from '@/generated/prisma/client';

interface StatusBadgeProps {
  status: EpisodeStatus | string;
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const config: Record<string, { color: string; label: string; icon: string }> = {
    PENDING: { color: 'bg-gray-100 text-gray-800', label: 'Pending', icon: '○' },
    DOWNLOADING: { color: 'bg-blue-100 text-blue-800', label: 'Downloading', icon: '↓' },
    TRANSCRIBING: { color: 'bg-yellow-100 text-yellow-800', label: 'Transcribing', icon: '✎' },
    TRANSCRIBED: { color: 'bg-teal-100 text-teal-800', label: 'Transcribed', icon: '✎✓' },
    ANALYZING: { color: 'bg-purple-100 text-purple-800', label: 'Analyzing', icon: '⚡' },
    COMPLETED: { color: 'bg-green-100 text-green-800', label: 'Completed', icon: '✓' },
    FAILED: { color: 'bg-red-100 text-red-800', label: 'Failed', icon: '✕' },
  };

  const c = config[status] || config.PENDING;

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${c.color}`}>
      <span>{c.icon}</span>
      {c.label}
    </span>
  );
}
