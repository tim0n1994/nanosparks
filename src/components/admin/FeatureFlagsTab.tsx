'use client';

import { useEffect, useState } from 'react';
import { Flag } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FlagCategory, FlagMeta, FlagRisk } from '@/lib/feature-flags';

interface RegistryResponse {
  flags: Record<string, boolean>;
  registry: FlagMeta[];
  categories: Record<FlagCategory, { label: string; order: number }>;
}

const RISK_LABEL: Record<FlagRisk, string> = {
  safe: '低风险',
  moderate: '中风险',
  dangerous: '高风险',
};

const RISK_CLASS: Record<FlagRisk, string> = {
  safe: 'bg-green-100 text-green-700',
  moderate: 'bg-amber-100 text-amber-700',
  dangerous: 'bg-red-100 text-red-700',
};

export default function FeatureFlagsTab() {
  const [data, setData] = useState<RegistryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/admin/features')
      .then(async (r) => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          const hint = r.status === 401
            ? '登录状态已过期，请退出后重新登录刷新管理员权限。'
            : r.status === 403
              ? '当前账号不是管理员。'
              : '加载失败';
          throw new Error(d.error || hint);
        }
        return r.json() as Promise<RegistryResponse>;
      })
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setError(String((e as Error).message)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  async function toggle(key: string, value: boolean) {
    if (!data) return;
    const prev = data.flags[key];
    setData({ ...data, flags: { ...data.flags, [key]: value } });
    setSaving(key);
    setError(null);
    try {
      const res = await fetch('/api/admin/features', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || '保存失败');
      }
      const d = (await res.json()) as { flags: Record<string, boolean> };
      setData({ ...data, flags: d.flags });
    } catch (e) {
      // roll back
      setData((cur) => (cur ? { ...cur, flags: { ...cur.flags, [key]: prev } } : cur));
      setError(String((e as Error).message));
    } finally {
      setSaving(null);
    }
  }

  if (loading) return <p className="text-sm text-ink-muted">加载中…</p>;
  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-100 p-5">
        <p className="text-sm font-medium text-red-700">功能开关加载失败</p>
        <p className="mt-1 text-sm text-red-700">{error}</p>
      </div>
    );
  }
  if (!data) return null;

  // Group flags by category, sorted by category order.
  const cats = Object.entries(data.categories).sort((a, b) => a[1].order - b[1].order);
  const enabledCount = Object.values(data.flags).filter(Boolean).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 text-sm text-ink-muted">
        <span className="inline-flex items-center gap-1.5">
          <Flag aria-hidden="true" size={16} strokeWidth={1.5} />
          共 {data.registry.length} 项 · 开启 {enabledCount} 项
        </span>
        {saving && <span className="text-link">保存中…</span>}
      </div>

      {cats.map(([cat, meta]) => {
        const flags = data.registry.filter((f) => f.category === cat);
        if (flags.length === 0) return null;
        return (
          <section key={cat}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-muted">
                {meta.label}
              </h2>
              <span className="text-2xs text-ink-muted/70">{flags.length} 项</span>
            </div>
            <div className="overflow-hidden rounded-lg border border-line bg-surface-raised">
              {flags.map((f, i) => (
                <div
                  key={f.key}
                  className={cn(
                    'flex items-start justify-between gap-4 px-5 py-4 transition-colors hover:bg-surface-sunken/50',
                    i > 0 && 'border-t border-line',
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-ink">{f.label}</p>
                      <span className={cn('rounded px-1.5 py-0.5 text-2xs font-medium', RISK_CLASS[f.risk])}>
                        {RISK_LABEL[f.risk]}
                      </span>
                    </div>
                    <p className="mt-0.5 text-sm text-ink-muted">{f.description}</p>
                    <p className="mt-1 text-xs text-ink-muted/70">关闭影响：{f.impact}</p>
                  </div>
                  <Toggle
                    checked={data.flags[f.key] ?? f.defaultEnabled}
                    disabled={saving === f.key}
                    onChange={(v) => toggle(f.key, v)}
                  />
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Toggle({ checked, disabled, onChange }: { checked: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
        checked ? 'bg-accent-600' : 'bg-line',
      )}
    >
      <span className={cn('inline-block h-5 w-5 transform rounded-full bg-surface-raised shadow transition-transform', checked ? 'translate-x-5' : 'translate-x-0.5')} />
    </button>
  );
}
