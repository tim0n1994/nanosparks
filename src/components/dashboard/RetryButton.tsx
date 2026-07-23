'use client';

import { useState } from 'react';
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
      className="rounded-md bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-40"
    >
      {retrying ? '重试中…' : '重试'}
    </button>
  );
}
