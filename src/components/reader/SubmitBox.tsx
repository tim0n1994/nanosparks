'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

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

const STAGE_HINTS: Record<string, string> = {
  not_found: '链接无效或内容已删除',
  spotify_exclusive: 'Spotify 独占内容无法获取',
  login_required: '该内容需要登录才能获取',
  region_restricted: '该内容受地区限制',
  no_audio: '该链接没有可获取的音频',
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
    if (!trimmed) {
      setError('请粘贴一条播客链接');
      return;
    }
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
      } else {
        setResult(data);
        // Single episode + cache hit → jump straight to the reader.
        if (data.conversationId && !data.multiEpisode) {
          router.push(`/read/${data.conversationId}`);
        }
      }
    } catch {
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full">
      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="粘贴播客链接（小宇宙 / YouTube / Apple / B站 / RSS / 音频直链）"
          autoFocus
          className="w-full px-5 py-4 text-base rounded-2xl border border-gray-200 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 bg-white"
        />
        <button
          type="submit"
          disabled={loading || !url.trim()}
          className="w-full px-5 py-3 rounded-2xl bg-gray-900 text-white text-base font-medium disabled:opacity-40 hover:bg-gray-800 transition"
        >
          {loading ? '处理中…' : '读掉它'}
        </button>
      </form>

      {error && (
        <div className="mt-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          <p>{error}</p>
          {result?.kind && STAGE_HINTS[result.kind] && (
            <p className="mt-1 text-red-500 text-xs">{STAGE_HINTS[result.kind]}</p>
          )}
        </div>
      )}

      {result?.multiEpisode && result.episodes && (
        <div className="mt-6 space-y-2">
          <p className="text-sm text-gray-500">
            {result.showTitle ? `《${result.showTitle}》` : '该节目'} 共 {result.episodes.length} 集，选择一集：
          </p>
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 overflow-hidden bg-white">
            {result.episodes.slice(0, 20).map((ep) => (
              <li key={ep.episodeKey}>
                <SubmitEpisodeRow ep={ep} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {result?.conversationId && !result.multiEpisode && result.cached && (
        <div className="mt-4 text-sm text-gray-500">
          缓存命中，正在跳转阅读…
        </div>
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
    <button onClick={pick} disabled={loadingKey} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left disabled:opacity-50">
      {ep.coverUrl ? <img src={ep.coverUrl} alt="" className="w-10 h-10 rounded object-cover" /> : <div className="w-10 h-10 rounded bg-gray-200" />}
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-gray-900 truncate">{ep.title}</span>
        {ep.durationSec ? (
          <span className="block text-xs text-gray-400">{Math.round(ep.durationSec / 60)} 分钟</span>
        ) : null}
      </span>
      {loadingKey && <span className="text-xs text-gray-400">处理中…</span>}
    </button>
  );
}
