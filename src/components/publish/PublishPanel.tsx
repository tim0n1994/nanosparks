'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from '@/lib/i18n/useTranslation';

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

/** Variant → catalogue key, so the label follows the interface language. */
const VARIANT_KEYS: Record<string, string> = {
  quote: 'publish.style.quotes',
  list: 'publish.style.list',
  controversy: 'publish.style.debate',
  digest: 'publish.style.brief',
  answer: 'publish.style.answer',
};

export default function PublishPanel({ conversationId }: { conversationId: string }) {
  const { t } = useTranslation();
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
        <h2 className="section-label">图文包</h2>
        <button
          onClick={generate}
          disabled={generating}
          className="px-3 py-1.5 rounded-md bg-ink px-3 py-1.5 text-xs font-medium text-surface-raised disabled:opacity-30 hover:bg-ink"
        >
          {generating ? t('publish.generating') : t('publish.generate')}
        </button>
      </div>

      {packages.length === 0 && !generating && (
        <p className="text-xs text-ink-muted">{t('publish.hint')}</p>
      )}

      {packages.map((pkg) => {
        const copy = parseCopy(pkg);
        const isWechat = pkg.platform === 'wechat';
        return (
          <div key={pkg.id} className="rounded-lg border border-line bg-surface-raised p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-ink">
                {PLATFORM_LABELS[pkg.platform] ?? pkg.platform}
              </span>
              <span className="text-2xs text-ink-muted">
                {VARIANT_KEYS[pkg.variant] ? t(VARIANT_KEYS[pkg.variant]) : pkg.variant}
              </span>
              {pkg.sensitiveHits > 0 && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-600">
                  {pkg.sensitiveHits} 处敏感词
                </span>
              )}
              {pkg.status === 'published' && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600">已发布</span>
              )}
            </div>

            {copy && (
              <div className="space-y-1 text-sm text-ink-muted">
                {copy.title && <p className="font-medium text-ink">{copy.title}</p>}
                <p className="line-clamp-3 text-ink-muted">{copy.body?.slice(0, 200)}…</p>
                {copy.tags && (
                  <p className="text-xs text-blue-500">{copy.tags.map((t) => `#${t}`).join(' ')}</p>
                )}
              </div>
            )}

            <div className="flex gap-2 flex-wrap">
              {copy?.title && (
                <button
                  onClick={() => copyText(pkg, copy.title, `${pkg.id}-title`)}
                  className="px-2 py-1 rounded-md text-2xs bg-surface-sunken px-2 py-1 hover:bg-surface-sunken transition-colors"
                >
                  {copiedKey === `${pkg.id}-title` ? '✓' : t('publish.copyTitle')}
                </button>
              )}
              {copy?.body && (
                <button
                  onClick={() => copyText(pkg, copy.body, `${pkg.id}-body`, isWechat ? 'text/html' : 'text/plain')}
                  className="px-2 py-1 rounded-md text-2xs bg-surface-sunken px-2 py-1 hover:bg-surface-sunken transition-colors"
                >
                  {copiedKey === `${pkg.id}-body` ? '✓' : isWechat ? t('publish.copyBodyRich') : t('publish.copyBody')}
                </button>
              )}
              {copy?.tags && (
                <button
                  onClick={() => copy.tags && copyText(pkg, copy.tags.map((t) => `#${t}`).join(' '), `${pkg.id}-tags`)}
                  className="px-2 py-1 rounded-md text-2xs bg-surface-sunken px-2 py-1 hover:bg-surface-sunken transition-colors"
                >
                  {copiedKey === `${pkg.id}-tags` ? '✓' : t('publish.copyTags')}
                </button>
              )}
            </div>

            {pkg.status !== 'published' && (
              <div className="flex gap-2 items-center pt-2 border-t border-line-soft">
                <input
                  type="url"
                  placeholder={t('publish.linkPlaceholder')}
                  className="flex-1 rounded-md border border-line px-2 py-1 text-2xs"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const val = (e.target as HTMLInputElement).value;
                      if (val) void markPublished(pkg, val);
                    }
                  }}
                />
                <span className="text-2xs text-ink-muted">回车确认</span>
              </div>
            )}

            <p className="text-2xs text-ink-muted">
              {pkg.platform === 'xiaohongshu' && t('publish.disclosure.xhs')}
              {pkg.platform === 'wechat' && t('publish.disclosure.wechat')}
              {pkg.platform === 'zhihu' && t('publish.disclosure.zhihu')}
            </p>
          </div>
        );
      })}
    </div>
  );
}
