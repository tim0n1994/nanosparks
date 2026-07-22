'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface Package {
  id: string;
  platform: string;
  variant: string;
  copyText: string;
  status: string;
  publishedUrl: string | null;
  costUsd: number | null;
  sensitiveHits: number;
  assetsJson: unknown;
}

const PLATFORM_LABELS: Record<string, string> = {
  xiaohongshu: '小红书',
  wechat: '公众号',
  zhihu: '知乎',
};

const VARIANT_LABELS: Record<string, string> = {
  quote: '金句版',
  list: '清单版',
  controversy: '争议观点版',
  digest: '导读版',
  answer: '回答版',
};

export default function PublishPanel({ conversationId }: { conversationId: string }) {
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const loadedRef = useRef(false);

  const loadPackages = useCallback(async () => {
    try {
      const resp = await fetch(`/api/conversations/${conversationId}/packages`);
      if (resp.ok) {
        const data = await resp.json();
        setPackages(data.packages ?? []);
      }
    } catch { /* best-effort */ }
  }, [conversationId]);

  // Initial load: fetch packages once on mount.
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    fetch(`/api/conversations/${conversationId}/packages`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data?.packages) setPackages(data.packages); })
      .catch(() => {});
  }, [conversationId]);

  const generate = async () => {
    setGenerating(true);
    try {
      const resp = await fetch(`/api/conversations/${conversationId}/packages`, { method: 'POST' });
      if (resp.ok) {
        await loadPackages();
      }
    } finally {
      setGenerating(false);
    }
  };

  const copyText = async (pkg: Package, text: string, key: string, flavor: 'text/plain' | 'text/html' = 'text/plain') => {
    try {
      if (flavor === 'text/html' && navigator.clipboard.write) {
        const blob = new Blob([text], { type: 'text/html' });
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': blob })]);
      } else {
        await navigator.clipboard.writeText(text);
      }
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch { /* clipboard may be blocked */ }
  };

  const markPublished = async (pkg: Package, publishedUrl: string) => {
    await fetch(`/api/packages/${pkg.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'published', publishedUrl }),
    });
    await loadPackages();
  };

  const parseCopy = (pkg: Package): { title: string; body: string; tags?: string[] } | null => {
    try {
      return JSON.parse(pkg.copyText);
    } catch {
      return null;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">图文包</h2>
        <button
          onClick={generate}
          disabled={generating}
          className="px-3 py-1.5 rounded-lg bg-gray-900 text-white text-xs font-medium disabled:opacity-40"
        >
          {generating ? '生成中…' : '生成图文包'}
        </button>
      </div>

      {packages.length === 0 && !generating && (
        <p className="text-sm text-gray-400">点击「生成图文包」一键产出三平台内容。</p>
      )}

      {packages.map((pkg) => {
        const copy = parseCopy(pkg);
        const isWechat = pkg.platform === 'wechat';
        return (
          <div key={pkg.id} className="rounded-xl bg-white border border-gray-200 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-800">
                {PLATFORM_LABELS[pkg.platform] ?? pkg.platform}
              </span>
              <span className="text-xs text-gray-400">
                {VARIANT_LABELS[pkg.variant] ?? pkg.variant}
              </span>
              {pkg.sensitiveHits > 0 && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                  {pkg.sensitiveHits} 处敏感词
                </span>
              )}
              {pkg.status === 'published' && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">已发布</span>
              )}
            </div>

            {copy && (
              <div className="space-y-1 text-sm text-gray-600">
                {copy.title && <p className="font-medium text-gray-800">{copy.title}</p>}
                <p className="line-clamp-3 text-gray-500">{copy.body?.slice(0, 200)}…</p>
                {copy.tags && (
                  <p className="text-xs text-blue-500">{copy.tags.map((t) => `#${t}`).join(' ')}</p>
                )}
              </div>
            )}

            <div className="flex gap-2 flex-wrap">
              {copy?.title && (
                <button
                  onClick={() => copyText(pkg, copy.title, `${pkg.id}-title`)}
                  className="px-2 py-1 rounded text-xs bg-gray-100 hover:bg-gray-200"
                >
                  {copiedKey === `${pkg.id}-title` ? '✓' : '复制标题'}
                </button>
              )}
              {copy?.body && (
                <button
                  onClick={() => copyText(pkg, copy.body, `${pkg.id}-body`, isWechat ? 'text/html' : 'text/plain')}
                  className="px-2 py-1 rounded text-xs bg-gray-100 hover:bg-gray-200"
                >
                  {copiedKey === `${pkg.id}-body` ? '✓' : isWechat ? '复制正文（保留样式）' : '复制正文'}
                </button>
              )}
              {copy?.tags && (
                <button
                  onClick={() => copy.tags && copyText(pkg, copy.tags.map((t) => `#${t}`).join(' '), `${pkg.id}-tags`)}
                  className="px-2 py-1 rounded text-xs bg-gray-100 hover:bg-gray-200"
                >
                  {copiedKey === `${pkg.id}-tags` ? '✓' : '复制 tags'}
                </button>
              )}
            </div>

            {pkg.status !== 'published' && (
              <div className="flex gap-2 items-center pt-1 border-t border-gray-100">
                <input
                  type="url"
                  placeholder="发布后回填链接…"
                  className="flex-1 px-2 py-1 text-xs rounded border border-gray-200"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const val = (e.target as HTMLInputElement).value;
                      if (val) void markPublished(pkg, val);
                    }
                  }}
                />
                <span className="text-xs text-gray-400">回车确认</span>
              </div>
            )}

            <p className="text-xs text-gray-400">
              {pkg.platform === 'xiaohongshu' && '小红书：设置→内容类型声明→勾选「含 AI 合成内容」'}
              {pkg.platform === 'wechat' && '公众号：发文时勾选「由 AI 生成」'}
              {pkg.platform === 'zhihu' && '知乎：发布时选择「包含 AI 生成内容」'}
            </p>
          </div>
        );
      })}
    </div>
  );
}
