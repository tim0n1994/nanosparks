'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface LlmSettingsForm {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** Parse LLM proxy output text to extract Base URL, API Key, and Model */
function parseLlmProxyOutput(text: string): Partial<LlmSettingsForm> {
  const result: Partial<LlmSettingsForm> = {};

  // Match patterns like:
  //   Base URL:           http://127.0.0.1:59786/v1
  //   API Key:             ccr-dev-39b3b66bb91c
  //   Model:               qwen3.5-35b-a3b
  const baseUrlMatch = text.match(/Base\s*URL:?\s*(https?:\/\/[^\s]+)/i);
  if (baseUrlMatch) result.baseUrl = baseUrlMatch[1].replace(/\/+$/, '');

  const apiKeyMatch = text.match(/API\s*Key:?\s*(\S+)/i);
  if (apiKeyMatch) result.apiKey = apiKeyMatch[1];

  const modelMatch = text.match(/(?:^|\n)\s*Model\s*:\s*(\S+)/i);
  if (modelMatch) result.model = modelMatch[1];

  return result;
}

export default function SettingsPage() {
  const { t } = useTranslation();
  const [form, setForm] = useState<LlmSettingsForm>({
    baseUrl: '',
    apiKey: '',
    model: '',
  });
  const [savedKey, setSavedKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState('');

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((data) => {
        setForm((prev) => ({
          ...prev,
          baseUrl: data.baseUrl || '',
          model: data.model || '',
        }));
        setSavedKey(data.apiKey || '');
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  const handlePasteParse = () => {
    if (!pasteText.trim()) return;
    const parsed = parseLlmProxyOutput(pasteText);
    const hasAny = parsed.baseUrl || parsed.apiKey || parsed.model;
    if (hasAny) {
      setForm((prev) => ({
        baseUrl: parsed.baseUrl ?? prev.baseUrl,
        apiKey: parsed.apiKey ?? prev.apiKey,
        model: parsed.model ?? prev.model,
      }));
      setPasteText('');
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: 'success', text: data.message || t('settings.saveDone') });
        setSavedKey(`...${form.apiKey.slice(-4)}`);
      } else {
        setMessage({ type: 'error', text: data.error || t('settings.saveFailed') });
      }
    } catch {
      setMessage({ type: 'error', text: t('settings.networkError') });
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
        body: JSON.stringify({
          baseUrl: form.baseUrl || 'https://api.openai.com/v1',
          apiKey: form.apiKey,
          model: form.model,
        }),
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
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-2xl font-bold text-gray-900">⚙️ {t('settings.llm.title')}</h1>
      <p className="mt-1 text-sm text-gray-500">
        {t('settings.llm.desc')}
      </p>

      {/* ── Paste LLM proxy output ── */}
      <div className="mt-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
        <label htmlFor="pasteOutput" className="block text-sm font-semibold text-blue-800">
          📋 {t('settings.paste.title')}
        </label>
        <p className="mt-1 text-xs text-blue-600">
          {t('settings.paste.hint')}
        </p>
        <textarea
          id="pasteOutput"
          rows={4}
          className="mt-2 block w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-mono shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder={t('settings.paste.placeholder')}
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
        />
        <button
          type="button"
          onClick={handlePasteParse}
          disabled={!pasteText.trim()}
          className="mt-2 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {t('settings.paste.parse')}
        </button>
      </div>

      {/* ── Form ── */}
      <div className="mt-6 space-y-5">
        {/* Base URL */}
        <div>
          <label htmlFor="baseUrl" className="block text-sm font-medium text-gray-700">
            {t('settings.llm.baseUrl')}
          </label>
          <input
            id="baseUrl"
            type="url"
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="http://127.0.0.1:59786/v1"
            value={form.baseUrl}
            onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
          />
        </div>

        {/* API Key */}
        <div>
          <label htmlFor="apiKey" className="block text-sm font-medium text-gray-700">
            {t('settings.llm.apiKey')}
          </label>
          <input
            id="apiKey"
            type="password"
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder={savedKey || 'sk-...'}
            value={form.apiKey}
            onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
          />
          {savedKey && !form.apiKey && (
            <p className="mt-1 text-xs text-green-600">
              {t('settings.llm.savedKey', { key: savedKey })}
            </p>
          )}
        </div>

        {/* Model */}
        <div>
          <label htmlFor="model" className="block text-sm font-medium text-gray-700">
            {t('settings.llm.model')}
          </label>
          <input
            id="model"
            type="text"
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="gpt-4o-mini"
            value={form.model}
            onChange={(e) => setForm({ ...form, model: e.target.value })}
          />
        </div>

        {/* Buttons */}
        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? t('settings.saving') : t('settings.save')}
          </button>

          <button
            type="button"
            onClick={handleTest}
            disabled={testing || !form.baseUrl || !form.apiKey}
            className="rounded-lg border border-gray-300 bg-white px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {testing ? t('settings.testing') : t('settings.test')}
          </button>
        </div>

        {/* Messages */}
        {message && (
          <div
            className={`rounded-lg p-3 text-sm ${
              message.type === 'success'
                ? 'bg-green-50 text-green-700'
                : 'bg-red-50 text-red-700'
            }`}
          >
            {message.text}
          </div>
        )}
        {testResult && (
          <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700 font-mono whitespace-pre-wrap">
            {testResult}
          </div>
        )}
      </div>

      {/* Help section */}
      <div className="mt-10 rounded-lg border border-gray-200 bg-gray-50 p-4">
        <h2 className="text-sm font-semibold text-gray-700">
          {t('settings.llm.helpTitle')}
        </h2>
        <p className="mt-2 text-xs text-gray-500 leading-relaxed">
          {t('settings.llm.helpDesc')}
        </p>
      </div>
    </div>
  );
}
