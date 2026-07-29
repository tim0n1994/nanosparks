'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';

interface LlmSettingsForm {
  baseUrl: string;
  apiKey: string;
  model: string;
  apiFormat?: 'openai' | 'anthropic';
}

interface PipelineModule {
  key: string;
  enabled: boolean;
  profile: string; // '' = use default
}

function parseLlmProxyOutput(text: string): Partial<LlmSettingsForm> {
  const result: Partial<LlmSettingsForm> = {};
  const baseUrlMatch = text.match(/Base\s*URL:?\s*(https?:\/\/[^\s]+)/i);
  if (baseUrlMatch) result.baseUrl = baseUrlMatch[1].replace(/\/+$/, '');
  const apiKeyMatch = text.match(/API\s*Key:?\s*(\S+)/i);
  if (apiKeyMatch) result.apiKey = apiKeyMatch[1];
  const modelMatch = text.match(/(?:^|\n)\s*Model\s*:\s*(\S+)/i);
  if (modelMatch) result.model = modelMatch[1];
  return result;
}

const MODULE_KEYS = ['extraction', 'correction', 'translation', 'entity', 'legacy', 'query'] as const;

export default function SettingsPage() {
  const { t } = useTranslation();
  const [form, setForm] = useState<LlmSettingsForm>({ baseUrl: '', apiKey: '', model: '' });
  const [savedKey, setSavedKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [pipeline, setPipeline] = useState<Record<string, PipelineModule>>({});

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((data) => {
        setForm((prev) => ({
          baseUrl: data.baseUrl ?? prev.baseUrl,
          apiKey: '',
          model: data.model ?? prev.model,
          apiFormat: data.apiFormat,
        }));
        if (data.hasApiKey && data.apiKey) setSavedKey(data.apiKey.slice(0, 8) + '…');
        // Pipeline toggles
        const pp: Record<string, PipelineModule> = {};
        for (const k of MODULE_KEYS) {
          pp[k] = {
            key: k,
            enabled: data.pipeline?.[k]?.enabled !== false,
            profile: data.pipeline?.[k]?.profile ?? '',
          };
        }
        setPipeline(pp);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handlePasteParse = () => {
    const parsed = parseLlmProxyOutput(pasteText);
    setForm((prev) => ({ ...prev, ...parsed }));
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const pipelineObj: Record<string, { enabled: boolean; profile?: string }> = {};
      for (const k of MODULE_KEYS) {
        pipelineObj[k] = { enabled: pipeline[k]?.enabled ?? true, profile: pipeline[k]?.profile || undefined };
      }
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, pipeline: pipelineObj }),
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

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/settings/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (res.ok) {
        setTestResult(`✅ ${t('settings.testOk')} "${data.reply}"`);
      } else {
        setTestResult(`❌ ${data.error || t('settings.testFail')}`);
      }
    } catch {
      setTestResult(`❌ ${t('settings.networkError')}`);
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-accent-600" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-form px-5 py-12">
      <h1 className="text-2xl font-bold text-ink">{t('settings.llm.title')}</h1>
      <p className="mt-1 text-sm text-ink-muted">{t('settings.llm.desc')}</p>

      {/* ── Paste LLM proxy output ── */}
      <div className="mt-6 rounded-lg border border-accent-200 bg-accent-50 p-4 dark:border-accent-900 dark:bg-accent-950/30">
        <label htmlFor="pasteOutput" className="block text-sm font-semibold text-accent-800 dark:text-accent-300">
          📋 {t('settings.paste.title')}
        </label>
        <p className="mt-1 text-xs text-accent-600 dark:text-accent-400">{t('settings.paste.hint')}</p>
        <textarea
          id="pasteOutput"
          rows={4}
          className="mt-2 block w-full rounded-lg border border-accent-200 bg-surface-raised px-3 py-2 text-xs font-mono shadow-sm focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500 dark:border-accent-900"
          placeholder={t('settings.paste.placeholder')}
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
        />
        <button
          type="button"
          onClick={handlePasteParse}
          disabled={!pasteText.trim()}
          className="mt-2 rounded-lg bg-accent-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-700 disabled:opacity-50"
        >
          {t('settings.paste.parse')}
        </button>
      </div>

      {/* ── Default LLM form ── */}
      <div className="mt-6 space-y-5">
        <div>
          <label htmlFor="baseUrl" className="block text-sm font-medium text-ink-subtle">
            {t('settings.llm.baseUrl')}
          </label>
          <input
            id="baseUrl"
            type="url"
            className="mt-1 block w-full rounded-lg border border-line px-3 py-2 text-sm shadow-sm focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
            placeholder="http://127.0.0.1:3458/v1"
            value={form.baseUrl}
            onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor="apiKey" className="block text-sm font-medium text-ink-subtle">
            {t('settings.llm.apiKey')}
          </label>
          <input
            id="apiKey"
            type="password"
            className="mt-1 block w-full rounded-lg border border-line px-3 py-2 text-sm shadow-sm focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
            placeholder={savedKey || 'sk-...'}
            value={form.apiKey}
            onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
          />
          {savedKey && !form.apiKey && (
            <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
              {t('settings.llm.savedKey', { key: savedKey })}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="model" className="block text-sm font-medium text-ink-subtle">
            {t('settings.llm.model')}
          </label>
          <input
            id="model"
            type="text"
            className="mt-1 block w-full rounded-lg border border-line px-3 py-2 text-sm shadow-sm focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500"
            placeholder="glm-5.2"
            value={form.model}
            onChange={(e) => setForm({ ...form, model: e.target.value })}
          />
        </div>
      </div>

      {/* ── Pipeline feature toggles ── */}
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
                <span
                  className={cn(
                    'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                    pipeline[mod]?.enabled ? 'translate-x-6' : 'translate-x-1',
                  )}
                />
              </button>
              {/* Label + hint */}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{t(`settings.pipeline.${mod}`)}</p>
                <p className="text-xs text-ink-muted">{t(`settings.pipeline.${mod}Hint`)}</p>
              </div>
              {/* Profile override (model name only — baseUrl/key reuse default) */}
              <input
                type="text"
                className="w-32 rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink placeholder:text-ink-muted focus:border-accent-500 focus:outline-none"
                placeholder={t('settings.pipeline.profileHint')}
                value={pipeline[mod]?.profile ?? ''}
                onChange={(e) => setPipeline((prev) => ({ ...prev, [mod]: { ...prev[mod], profile: e.target.value } }))}
                disabled={!pipeline[mod]?.enabled}
              />
            </div>
          ))}
        </div>
      </div>

      {/* ── Buttons ── */}
      <div className="mt-8 flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-accent-600 px-5 py-2 text-sm font-medium text-white hover:bg-accent-700 disabled:opacity-50"
        >
          {saving ? t('settings.saving') : t('settings.save')}
        </button>
        <button
          type="button"
          onClick={handleTest}
          disabled={testing || !form.baseUrl}
          className="rounded-lg border border-line bg-surface-raised px-4 py-2 text-sm font-medium text-ink hover:border-ink-muted disabled:opacity-50"
        >
          {testing ? t('settings.testing') : t('settings.test')}
        </button>
        {saved && <span className="text-sm text-emerald-600 dark:text-emerald-400">✓</span>}
        {message && <span className={cn('text-sm', message.type === 'error' ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400')}>{message.text}</span>}
        {testResult && <span className="text-xs text-ink-muted">{testResult}</span>}
      </div>
    </div>
  );
}
