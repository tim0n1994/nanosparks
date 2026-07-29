'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';

interface LlmProfile {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  apiFormat?: 'openai' | 'anthropic';
}

interface PipelineModule {
  enabled: boolean;
  profileId: string; // '' = use default
}

const MODULE_KEYS = ['extraction', 'correction', 'translation', 'entity', 'legacy', 'query'] as const;
const MODULE_LABELS: Record<string, string> = {
  extraction: '观点抽取',
  correction: '转写纠错',
  translation: '双语翻译',
  entity: '实体抽取',
  legacy: '旧版分析',
  query: '合集问答',
};

// ── Multi-endpoint parser ──
// Parses CCR proxy output with Local/Secondary/Tertiary sections.
interface ParsedSection {
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

function parseCcrOutput(text: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  // Match blocks: "Local Endpoint:", "Secondary Endpoint:", "Tertiary Endpoint:"
  const blockRegex = /(\w[\w\s]*?Endpoint):\s*([\s\S]*?)(?=\n\s*\w[\w\s]*?Endpoint:|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(text)) !== null) {
    const label = match[1].trim();
    const body = match[2];
    const baseUrlMatch = body.match(/Base\s*URL\s*\d*:?\s*(https?:\/\/[^\s]+)/i)
      || body.match(/Messages\s*URL\s*\d*:?\s*(https?:\/\/[^\s]+)/i);
    const apiKeyMatch = body.match(/API\s*Key\s*\d*:?\s*(\S+)/i);
    // "Model:" but NOT "Models URL:" — use negative lookahead on 's URL'
    const modelMatch = body.match(/^\s*Model\s*\d*:?\s+(\S+)/im);
    if (baseUrlMatch || modelMatch) {
      sections.push({
        label,
        baseUrl: baseUrlMatch ? baseUrlMatch[1].replace(/\/+$/, '') : '',
        apiKey: apiKeyMatch ? apiKeyMatch[1] : '',
        model: modelMatch ? modelMatch[1] : '',
      });
    }
  }
  // Fallback: single-endpoint format (Base URL / API Key / Model without sections)
  if (sections.length === 0) {
    const baseUrlMatch = text.match(/Base\s*URL:?\s*(https?:\/\/[^\s]+)/i);
    const apiKeyMatch = text.match(/API\s*Key:?\s*(\S+)/i);
    const modelMatch = text.match(/(?:^|\n)\s*Model\s*:\s*(\S+)/i);
    if (baseUrlMatch || modelMatch) {
      sections.push({
        label: 'Default',
        baseUrl: baseUrlMatch ? baseUrlMatch[1].replace(/\/+$/, '') : '',
        apiKey: apiKeyMatch ? apiKeyMatch[1] : '',
        model: modelMatch ? modelMatch[1] : '',
      });
    }
  }
  return sections;
}

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Auto-name profiles from model name
function nameFromModel(model: string, idx: number): string {
  const m = model.toLowerCase();
  if (m.includes('gemini')) return 'Gemini';
  if (m.includes('glm-5')) return 'GLM-5.2';
  if (m.includes('glm-4')) return 'GLM-4.5';
  if (m.includes('deepseek')) return 'DeepSeek';
  if (m.includes('claude')) return 'Claude';
  if (m.includes('gpt')) return 'GPT';
  return model.slice(0, 12) || `Profile ${idx + 1}`;
}

export default function SettingsPage() {
  const { t } = useTranslation();
  const [profiles, setProfiles] = useState<LlmProfile[]>([]);
  const [defaultProfileId, setDefaultProfileId] = useState('');
  const [pipeline, setPipeline] = useState<Record<string, PipelineModule>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [profileTesting, setProfileTesting] = useState<Record<string, boolean>>({});
  const [profileTestResult, setProfileTestResult] = useState<Record<string, string | null>>({});
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [parsedSections, setParsedSections] = useState<ParsedSection[]>([]);
  const [showParsed, setShowParsed] = useState(false);

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((data) => {
        if (data.profiles) setProfiles(data.profiles);
        if (data.defaultProfileId) setDefaultProfileId(data.defaultProfileId);
        const pp: Record<string, PipelineModule> = {};
        for (const k of MODULE_KEYS) {
          pp[k] = {
            enabled: data.pipeline?.[k]?.enabled !== false,
            profileId: data.pipeline?.[k]?.profileId ?? '',
          };
        }
        setPipeline(pp);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleParse = () => {
    const sections = parseCcrOutput(pasteText);
    setParsedSections(sections);
    setShowParsed(true);
  };

  const confirmParsed = () => {
    const newProfiles = parsedSections.map((s, i) => ({
      id: genId(),
      name: nameFromModel(s.model, i),
      baseUrl: s.baseUrl,
      apiKey: s.apiKey,
      model: s.model,
      apiFormat: s.baseUrl.includes('/messages') ? 'anthropic' as const : 'openai' as const,
    }));
    // Merge: keep existing, add new (dedup by baseUrl+model)
    setProfiles((prev) => {
      const existing = new Set(prev.map((p) => `${p.baseUrl}|${p.model}`));
      const filtered = newProfiles.filter((p) => !existing.has(`${p.baseUrl}|${p.model}`));
      return [...prev, ...filtered];
    });
    // Auto-select first new profile as default if none set
    if (!defaultProfileId && newProfiles.length > 0) {
      setDefaultProfileId(newProfiles[0].id);
    }
    setShowParsed(false);
    setPasteText('');
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const pipelineObj: Record<string, { enabled: boolean; profileId?: string }> = {};
      for (const k of MODULE_KEYS) {
        pipelineObj[k] = { enabled: pipeline[k]?.enabled ?? true, profileId: pipeline[k]?.profileId || undefined };
      }
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profiles, defaultProfileId, pipeline: pipelineObj }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setSaved(true);
      setMessage({ type: 'success', text: t('settings.saveDone') });
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setMessage({ type: 'error', text: t('settings.saveFailed') });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-accent-600" />
      </div>
    );
  }

  const defaultProfile = profiles.find((p) => p.id === defaultProfileId);

  return (
    <div className="mx-auto max-w-app px-5 py-12">
      <h1 className="text-2xl font-bold text-ink">{t('settings.llm.title')}</h1>
      <p className="mt-1 text-sm text-ink-muted">{t('settings.llm.desc')}</p>

      {/* ── Paste CCR output (multi-endpoint) ── */}
      <div className="mt-6 rounded-lg border border-accent-200 bg-accent-50 p-4 dark:border-accent-900 dark:bg-accent-950/30">
        <label htmlFor="pasteOutput" className="block text-sm font-semibold text-accent-800 dark:text-accent-300">
          📋 {t('settings.paste.title')}
        </label>
        <p className="mt-1 text-xs text-accent-600 dark:text-accent-400">{t('settings.paste.hint')}</p>
        <textarea
          id="pasteOutput"
          rows={6}
          className="mt-2 block w-full rounded-lg border border-accent-200 bg-surface-raised px-3 py-2 text-xs font-mono shadow-sm focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500 dark:border-accent-900"
          placeholder={t('settings.paste.placeholder')}
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
        />
        <button
          type="button"
          onClick={handleParse}
          disabled={!pasteText.trim()}
          className="mt-2 rounded-lg bg-accent-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-700 disabled:opacity-50"
        >
          {t('settings.paste.parse')}
        </button>

        {/* Parsed sections preview */}
        {showParsed && parsedSections.length > 0 && (
          <div className="mt-3 space-y-2">
            <p className="text-xs font-medium text-accent-800 dark:text-accent-300">
              检测到 {parsedSections.length} 个端点：
            </p>
            {parsedSections.map((s, i) => (
              <div key={i} className="flex items-center gap-2 rounded-md border border-accent-200 bg-surface-raised px-3 py-2 text-xs dark:border-accent-900">
                <span className="font-medium text-ink">{nameFromModel(s.model, i)}</span>
                <span className="text-ink-muted">{s.model}</span>
                <span className="text-ink-muted">· {s.baseUrl.slice(0, 40)}</span>
              </div>
            ))}
            <button
              type="button"
              onClick={confirmParsed}
              className="rounded-md bg-accent-600 px-3 py-1 text-xs font-medium text-white hover:bg-accent-700"
            >
              确认添加
            </button>
          </div>
        )}
      </div>

      {/* ── LLM Profiles list ── */}
      <div className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">LLM 端点</h2>
          <span className="text-xs text-ink-muted">{profiles.length} 个已配置</span>
        </div>

        {profiles.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">粘贴上方 CCR 输出即可自动添加端点。</p>
        ) : (
          <div className="mt-3 space-y-3">
            {profiles.map((p) => (
              <div
                key={p.id}
                className={cn(
                  'rounded-lg border p-4',
                  p.id === defaultProfileId
                    ? 'border-accent-500 bg-accent-50 dark:border-accent-700 dark:bg-accent-950/30'
                    : 'border-line bg-surface-raised',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        className="bg-transparent text-sm font-semibold text-ink focus:outline-none"
                        value={p.name}
                        onChange={(e) => setProfiles((prev) => prev.map((x) => x.id === p.id ? { ...x, name: e.target.value } : x))}
                      />
                      {p.id === defaultProfileId && (
                        <span className="rounded-full bg-accent-600 px-2 py-0.5 text-2xs font-medium text-white">默认</span>
                      )}
                    </div>
                    <div className="mt-1 space-y-1 text-xs text-ink-muted">
                      <div className="flex gap-2">
                        <span className="w-16 shrink-0 text-ink-subtle">Model</span>
                        <input
                          type="text"
                          className="flex-1 bg-transparent font-mono text-ink focus:outline-none"
                          value={p.model}
                          onChange={(e) => setProfiles((prev) => prev.map((x) => x.id === p.id ? { ...x, model: e.target.value } : x))}
                        />
                      </div>
                      <div className="flex gap-2">
                        <span className="w-16 shrink-0 text-ink-subtle">Base URL</span>
                        <input
                          type="text"
                          className="flex-1 bg-transparent font-mono text-ink focus:outline-none"
                          value={p.baseUrl}
                          onChange={(e) => setProfiles((prev) => prev.map((x) => x.id === p.id ? { ...x, baseUrl: e.target.value } : x))}
                        />
                      </div>
                      <div className="flex gap-2">
                        <span className="w-16 shrink-0 text-ink-subtle">API Key</span>
                        <input
                          type="password"
                          className="flex-1 bg-transparent font-mono text-ink focus:outline-none"
                          value={p.apiKey}
                          onChange={(e) => setProfiles((prev) => prev.map((x) => x.id === p.id ? { ...x, apiKey: e.target.value } : x))}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {p.id !== defaultProfileId && (
                      <button
                        type="button"
                        onClick={() => setDefaultProfileId(p.id)}
                        className="text-xs text-accent-600 hover:underline dark:text-accent-400"
                      >
                        设为默认
                      </button>
                    )}
                    <button
                      type="button"
                        disabled={!!profileTesting[p.id]}
                        onClick={async () => {
                          setProfileTesting((prev) => ({ ...prev, [p.id]: true }));
                          setProfileTestResult((prev) => ({ ...prev, [p.id]: null }));
                          try {
                            const res = await fetch('/api/settings/test', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ baseUrl: p.baseUrl, apiKey: p.apiKey, model: p.model }),
                            });
                            const data = await res.json();
                            setProfileTestResult((prev) => ({
                              ...prev,
                              [p.id]: res.ok ? `✅ ${data.reply ?? 'ok'}` : `❌ ${data.error ?? 'failed'}`,
                            }));
                          } catch {
                            setProfileTestResult((prev) => ({ ...prev, [p.id]: '❌ 网络错误' }));
                          } finally {
                            setProfileTesting((prev) => ({ ...prev, [p.id]: false }));
                          }
                        }}
                        className="text-xs text-ink-muted hover:text-link disabled:opacity-50"
                      >
                        {profileTesting[p.id] ? '测试中…' : '测试连接'}
                      </button>
                      {profileTestResult[p.id] && (
                        <span className="text-2xs text-ink-muted">{profileTestResult[p.id]}</span>
                      )}
                    <button
                      type="button"
                      onClick={() => {
                        setProfiles((prev) => prev.filter((x) => x.id !== p.id));
                        if (p.id === defaultProfileId) setDefaultProfileId('');
                      }}
                      className="text-xs text-red-600 hover:underline dark:text-red-400"
                    >
                      删除
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Pipeline toggles with profile dropdown ── */}
      <div className="mt-10">
        <h2 className="text-lg font-bold text-ink">⚙️ {t('settings.pipeline.title')}</h2>
        <p className="mt-1 text-sm text-ink-muted">{t('settings.pipeline.desc')}</p>
        <div className="mt-4 space-y-3">
          {MODULE_KEYS.map((mod) => (
            <div key={mod} className="flex items-center gap-4 rounded-lg border border-line bg-surface-raised px-4 py-3">
              {/* Toggle */}
              <button
                type="button"
                role="switch"
                aria-checked={pipeline[mod]?.enabled ?? true}
                onClick={() => setPipeline((prev) => ({ ...prev, [mod]: { ...prev[mod], enabled: !prev[mod]?.enabled } }))}
                className={cn(
                  'relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors',
                  pipeline[mod]?.enabled ? 'bg-accent-600' : 'bg-line',
                )}
              >
                <span className={cn('inline-block h-4 w-4 transform rounded-full bg-white transition-transform', pipeline[mod]?.enabled ? 'translate-x-6' : 'translate-x-1')} />
              </button>
              {/* Label */}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{MODULE_LABELS[mod]}</p>
                <p className="text-xs text-ink-muted">{t(`settings.pipeline.${mod}Hint`)}</p>
              </div>
              {/* Profile dropdown */}
              <select
                className="w-40 rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-ink focus:border-accent-500 focus:outline-none disabled:opacity-40"
                value={pipeline[mod]?.profileId ?? ''}
                onChange={(e) => setPipeline((prev) => ({ ...prev, [mod]: { ...prev[mod], profileId: e.target.value } }))}
                disabled={!pipeline[mod]?.enabled}
              >
                <option value="">{defaultProfile ? `${defaultProfile.name}（默认）` : '默认端点'}</option>
                {profiles.filter((p) => p.id !== defaultProfileId).map((p) => (
                  <option key={p.id} value={p.id}>{p.name} · {p.model}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>

      {/* ── Save ── */}
      <div className="mt-8 flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-accent-600 px-5 py-2 text-sm font-medium text-white hover:bg-accent-700 disabled:opacity-50"
        >
          {saving ? t('settings.saving') : t('settings.save')}
        </button>
        {saved && <span className="text-sm text-emerald-600 dark:text-emerald-400">✓</span>}
        {message && <span className={cn('text-sm', message.type === 'error' ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400')}>{message.text}</span>}
      </div>
    </div>
  );
}
