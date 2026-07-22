'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface IngestResponse {
  success: boolean;
  conversationId?: string;
  cached?: boolean;
  title?: string;
  multiEpisode?: boolean;
  showTitle?: string;
  episodes?: Array<{ episodeKey: string; platform: string; title: string; durationSec?: number; coverUrl?: string; audioUrl?: string }>;
  error?: string;
  kind?: string;
  platform?: string;
}

const ERROR_HINTS: Record<string, string> = {
  not_found: '链接无效或内容已删除',
  spotify_exclusive: 'Spotify 独占内容无法获取',
  login_required: '该内容需要登录才能获取',
  region_restricted: '该内容受地区限制',
  no_audio: '该链接没有可获取的音频',
  quota_exhausted: '本月额度已用完',
};

export default function SubmitBox() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<IngestResponse | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setResult(null);
    const trimmed = url.trim();
    if (!trimmed) return;
    setLoading(true);
    try {
      const resp = await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed, mode: 'robot' }),
      });
      const data = (await resp.json()) as IngestResponse;
      if (!data.success) {
        setError(data.error || '处理失败');
        setResult(data);
      } else if (data.conversationId && !data.multiEpisode) {
        router.push(`/read/${data.conversationId}`);
      } else {
        setResult(data);
      }
    } catch {
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full">
      <form onSubmit={handleSubmit}>
        <div className="group relative flex items-center rounded-xl border border-zinc-200 bg-white shadow-sm transition-shadow focus-within:border-accent-400 focus-within:shadow-md focus-within:ring-1 focus-within:ring-accent-200">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="粘贴播客链接…"
            autoFocus
            disabled={loading}
            className="flex-1 bg-transparent px-4 py-3 text-[15px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={loading || !url.trim()}
            className="m-1 flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-[13px] font-medium text-white transition-all hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-30"
          >
            {loading ? (
              <>
                <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
                  <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                处理中
              </>
            ) : (
              '读掉它'
            )}
          </button>
        </div>
      </form>

      {/* Error */}
      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
          <p>{error}</p>
          {result?.kind && ERROR_HINTS[result.kind] && (
            <p className="mt-0.5 text-[12px] text-red-400">{ERROR_HINTS[result.kind]}</p>
          )}
        </div>
      )}

      {/* Multi-episode selection */}
      {result?.multiEpisode && result.episodes && (
        <div className="mt-4 space-y-1.5">
          <p className="section-label mb-2">
            {result.showTitle ? `《${result.showTitle}》` : '该节目'} · 选择一集
          </p>
          <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
            {result.episodes.slice(0, 20).map((ep) => (
              <SubmitEpisodeRow key={ep.episodeKey} ep={ep} />
            ))}
          </div>
        </div>
      )}

      {/* Cache hit */}
      {result?.conversationId && !result.multiEpisode && result.cached && (
        <p className="mt-3 text-[13px] text-zinc-400">缓存命中，正在跳转…</p>
      )}
    </div>
  );
}

function SubmitEpisodeRow({ ep }: { ep: { episodeKey: string; title: string; durationSec?: number; coverUrl?: string; audioUrl?: string } }) {
  const [loadingKey, setLoadingKey] = useState(false);
  const router = useRouter();

  const pick = async () => {
    setLoadingKey(true);
    try {
      const resp = await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: ep.audioUrl || ep.episodeKey, mode: 'robot' }),
      });
      const data = (await resp.json()) as IngestResponse;
      if (data.success && data.conversationId) {
        router.push(`/read/${data.conversationId}`);
      }
    } finally {
      setLoadingKey(false);
    }
  };

  return (
    <button
      onClick={pick}
      disabled={loadingKey}
      className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-zinc-50 disabled:opacity-50"
    >
      {ep.coverUrl ? (
        <img src={ep.coverUrl} alt="" className="h-9 w-9 flex-shrink-0 rounded object-cover" />
      ) : (
        <div className="h-9 w-9 flex-shrink-0 rounded bg-zinc-100" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-zinc-800">{ep.title}</span>
        {ep.durationSec ? (
          <span className="block font-mono text-[11px] text-zinc-400">{Math.round(ep.durationSec / 60)} 分钟</span>
        ) : null}
      </span>
      {loadingKey && (
        <svg className="h-3.5 w-3.5 animate-spin text-zinc-400" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
          <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}
