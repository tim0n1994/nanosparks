'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function RetryButton({ sourceId, conversationId }: { sourceId: string; conversationId: string }) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);

  const handleRetry = async () => {
    setRetrying(true);
    try {
      // Reset conversation status + re-enqueue via ingest
      await fetch(`/api/conversations/${conversationId}/reextract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }).catch(() => {});
      // Jump to the reader to see progress
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
