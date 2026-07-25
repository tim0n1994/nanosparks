'use client';

import { useState } from 'react';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useRouter } from 'next/navigation';

interface Props {
  sourceId?: string;
  conversationId: string;
  // When true (or when the conversation has no turns), retry re-runs the full
  // pipeline (download + transcribe + analyze) via /reprocess. Otherwise it only
  // re-runs analysis via /reextract.
  fullPipeline?: boolean;
}

export default function RetryButton({ conversationId, fullPipeline }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);

  const handleRetry = async () => {
    setRetrying(true);
    try {
      const endpoint = fullPipeline ? 'reprocess' : 'reextract';
      await fetch(`/api/conversations/${conversationId}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }).catch(() => {});
      // Jump to the reader to watch the live progress stream.
      router.push(`/read/${conversationId}`);
    } finally {
      setRetrying(false);
    }
  };

  return (
    <button
      onClick={handleRetry}
      disabled={retrying}
      className="rounded-md bg-ink px-2.5 py-1 text-2xs font-medium text-surface-raised transition-colors hover:bg-ink disabled:opacity-40"
    >
      {retrying ? t('common.retrying') : t('common.retry')}
    </button>
  );
}
