'use client';

import { useState, useEffect, useRef } from 'react';
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

interface ProgressDetail {
  stage: string;
  label: string;
  hint: string;
  progress: number;
  elapsedMs: number;
  etaMs: number;
  turnCount: number;
  thoughtUnitCount: number;
}

const ERROR_HINTS: Record<string, string> = {
  concurrent: '有一个任务正在处理中',
  not_found: '链接无效或内容已删除',
  spotify_exclusive: 'Spotify 独占内容无法获取',
  login_required: '该内容需要登录才能获取',
  region_restricted: '该内容受地区限制',
  no_audio: '该链接没有可获取的音频',
  quota_exhausted: '本月额度已用完',
};

/** Format ms as m:ss or s. */
function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m > 0) return `${m}:${r.toString().padStart(2, '0')}`;
  return `${r}s`;
}

// Progress stage display config
const STAGES = [
  { key: 'queued', label: '排队中', hint: '已加入处理队列', icon: '⏳' },
  { key: 'downloading', label: '下载音频', hint: '正在获取播客音频文件', icon: '⬇️' },
  { key: 'transcribing', label: '语音转写', hint: 'Qwen3-ASR 正在识别语音内容', icon: '🎙️' },
  { key: 'diarizing', label: '说话人分离', hint: '正在识别谁在说话', icon: '👥' },
  { key: 'extracting', label: '生成导读', hint: '正在提炼要点与金句', icon: '✨' },
  { key: 'ready', label: '处理完成', hint: '可以阅读了', icon: '✅' },
  { key: 'failed', label: '处理失败', hint: '请重试或换一个链接', icon: '❌' },
];

export default function SubmitBox() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<IngestResponse | null>(null);
  const [progressStage, setProgressStage] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProgressDetail | null>(null);
  const [tickCount, setTickCount] = useState(0); // drives a smooth elapsed timer
  const [progressConversationId, setProgressConversationId] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  // Consume the SSE progress stream for live stage + counts + eta.
  // A local 1s interval keeps the elapsed timer smooth between heartbeats.
  useEffect(() => {
    if (!progressConversationId) return;
    let cancelled = false;
    const es = new EventSource(`/api/conversations/${progressConversationId}/progress`);
    esRef.current = es;

    const apply = (d: ProgressDetail) => {
      if (cancelled) return;
      setDetail(d);
      setProgressStage(d.stage);
      if (d.stage === 'ready') {
        es.close();
        setTimeout(() => router.push(`/read/${progressConversationId}`), 900);
      } else if (d.stage === 'failed') {
        es.close();
      }
    };

    es.addEventListener('stage', (e) => apply(JSON.parse((e as MessageEvent).data)));
    es.addEventListener('tick', (e) => apply(JSON.parse((e as MessageEvent).data)));
    es.addEventListener('error', (e) => {
      // EventSource 'error' also fires on a clean close; only treat real errors.
      if (es.readyState === EventSource.CLOSED) return;
      console.warn('progress stream error', e);
    });

    // Smooth 1s elapsed timer between SSE heartbeats.
    const timer = setInterval(() => setTickCount((n) => n + 1), 1000);

    return () => {
      cancelled = true;
      clearInterval(timer);
      es.close();
      esRef.current = null;
    };
  }, [progressConversationId, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setResult(null);
    setProgressStage(null);
    setDetail(null);
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
      } else if (data.cached && data.conversationId) {
        // Cache hit — go straight to reader
        router.push(`/read/${data.conversationId}`);
      } else if (data.conversationId && !data.multiEpisode) {
        // Start streaming progress
        setProgressConversationId(data.conversationId);
        setProgressStage('queued');
      } else {
        setResult(data);
      }
    } catch {
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  const currentStageIndex = progressStage
    ? STAGES.findIndex((s) => s.key === progressStage)
    : -1;
  // tickCount referenced so the elapsed display re-renders every second.
  void tickCount;

 return (
    <div className="w-full space-y-4">
      {/* Input form — always available so a second episode can be queued while one processes */}
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
                  提交中
                </>
              ) : (
                '读掉它'
              )}
            </button>
          </div>
      </form>

     {/* Progress display */}
     {progressStage && (
       <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
         <div className="mb-5 flex items-center justify-between">
           <h3 className="text-[15px] font-semibold text-zinc-900">处理进度</h3>
           {progressStage !== 'failed' && progressStage !== 'ready' && (
             <span className="font-mono text-[11px] text-zinc-400 animate-pulse">实时更新中…</span>
           )}
         </div>

          {/* Live metrics: progress bar + elapsed/eta + live counts */}
          {detail && progressStage !== 'failed' && (
            <div className="mb-5">
              <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
                <div
                  className="h-full rounded-full bg-accent-500 transition-all duration-700 ease-out"
                  style={{ width: `${Math.round((detail.progress || 0) * 100)}%` }}
                />
              </div>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[11px] text-zinc-500">
                <span>
                  <span className="text-zinc-400">已用</span>{' '}
                  <span className="font-medium text-zinc-700">{fmtDuration(detail.elapsedMs)}</span>
                </span>
                {progressStage !== 'ready' && detail.etaMs > 0 && (
                  <span>
                    <span className="text-zinc-400">预计剩余</span>{' '}
                    <span className="font-medium text-zinc-700">{fmtDuration(detail.etaMs)}</span>
                  </span>
                )}
                {detail.turnCount > 0 && (
                  <span>
                    <span className="text-zinc-400">已转写</span>{' '}
                    <span className="font-medium text-zinc-700">{detail.turnCount} 段</span>
                  </span>
                )}
                {detail.thoughtUnitCount > 0 && (
                  <span>
                    <span className="text-zinc-400">已提炼</span>{' '}
                    <span className="font-medium text-zinc-700">{detail.thoughtUnitCount} 要点</span>
                  </span>
                )}
              </div>
            </div>
          )}

         {/* Stage timeline */}
          <div className="space-y-1">
            {STAGES.filter((s) => s.key !== 'failed').map((stage, i) => {
              const stageIndex = STAGES.findIndex((s) => s.key === stage.key);
              const isDone = currentStageIndex > stageIndex || progressStage === 'ready';
              const isActive = currentStageIndex === stageIndex && progressStage !== 'ready';
              const isFailed = progressStage === 'failed' && i === currentStageIndex;

              return (
                <div key={stage.key} className="flex items-center gap-3 py-1.5">
                  {/* Icon circle */}
                  <div className="relative flex-shrink-0">
                    {isDone ? (
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 text-white">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                          <path d="M3 7l3 3 5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                    ) : isActive ? (
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-600 text-white">
                        <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 16 16" fill="none">
                          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                          <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                      </div>
                    ) : isFailed ? (
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-red-500 text-white text-[14px]">!</div>
                    ) : (
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-100 text-zinc-300">
                        <div className="h-2 w-2 rounded-full bg-zinc-300" />
                      </div>
                    )}
                    {/* Connector line */}
                    {i < STAGES.length - 2 && (
                      <div className={`absolute left-1/2 top-7 h-[calc(100%-4px)] w-px -translate-x-1/2 ${isDone ? 'bg-emerald-300' : 'bg-zinc-150'}`} />
                    )}
                  </div>

                  {/* Label + hint */}
                  <div className="min-w-0 flex-1">
                    <p className={`text-[13px] font-medium ${isDone ? 'text-zinc-400 line-through decoration-zinc-200' : isActive ? 'text-zinc-900' : isFailed ? 'text-red-600' : 'text-zinc-400'}`}>
                      {stage.label}
                    </p>
                    {(isActive || isFailed) && (
                      <p className={`text-[12px] ${isFailed ? 'text-red-400' : 'text-zinc-400'}`}>
                        {isFailed ? '处理失败，请重试或换一个链接' : stage.hint}
                      </p>
                    )}
                  </div>

                  {/* Active indicator */}
                  {isActive && (
                    <span className="flex-shrink-0 rounded-full bg-accent-50 px-2 py-0.5 text-[10px] font-medium text-accent-600">
                      进行中
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Failed retry — re-run the full pipeline (download + transcribe + analyze) */}
          {progressStage === 'failed' && progressConversationId && (
            <button
              onClick={async () => {
                setProgressStage('queued');
                setDetail(null);
                try {
                  await fetch(`/api/conversations/${progressConversationId}/reprocess`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({}),
                  });
                  // Re-open the SSE stream by toggling the conversation id.
                  const id = progressConversationId;
                  setProgressConversationId(null);
                  setTimeout(() => setProgressConversationId(id), 50);
                } catch {
                  setProgressStage('failed');
                }
              }}
              className="mt-4 rounded-md bg-zinc-900 px-4 py-2 text-[13px] font-medium text-white hover:bg-zinc-700"
            >
              重新处理
            </button>
          )}
        </div>
      )}

      {/* Error */}
      {error && !progressStage && (
        <div className={`mt-3 rounded-lg border px-3 py-2.5 text-[13px] ${
          result?.conversationId
            ? 'border-amber-200 bg-amber-50 text-amber-800'
            : 'border-red-200 bg-red-50 text-red-700'
        }`}>
          <p>{error}</p>
          {result?.conversationId && (
            <a
              href={`/read/${result.conversationId}`}
              className="mt-1.5 inline-flex items-center gap-1 text-[13px] font-medium text-accent-600 hover:underline"
            >
              查看处理进度 →
            </a>
          )}
          {!result?.conversationId && result?.kind && ERROR_HINTS[result.kind] && (
            <p className="mt-0.5 text-[12px] opacity-70">{ERROR_HINTS[result.kind]}</p>
          )}
        </div>
      )}

      {/* Multi-episode selection */}
      {result?.multiEpisode && result.episodes && !progressStage && (
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
