'use client';

export default function RetryButton({ sourceId }: { sourceId: string }) {
  return (
    <button
      className="px-3 py-1 text-xs bg-red-50 text-red-600 rounded hover:bg-red-100 transition-colors"
      onClick={() => {
        fetch(`/api/sources/${sourceId}`, { method: 'POST' }).catch(() => {});
      }}
    >
      Retry
    </button>
  );
}
