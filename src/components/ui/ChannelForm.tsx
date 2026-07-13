'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface ChannelFormProps {
  onSubmit?: (url: string, mode: string) => void;
}

export default function ChannelForm({ onSubmit }: ChannelFormProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const [mode, setMode] = useState('robot');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const validateUrl = (input: string): boolean => {
    const youtubePatterns = [
      /youtube\.com\/channel\//,
      /youtube\.com\/c\//,
      /youtube\.com\/@/,
      /youtube\.com\/playlist/,
      /youtube\.com\/watch/,
      /youtu\.be\//,
    ];
    if (youtubePatterns.some((p) => p.test(input))) return true;

    // Xiaoyuzhou FM
    if (/xiaoyuzhoufm\.com\/(podcast|episode)\//.test(input)) return true;

    return false;
  };

  const getPlaceholder = (): string => {
    if (/xiaoyuzhoufm\.com/.test(url)) return 'https://www.xiaoyuzhoufm.com/podcast/...';
    return 'https://youtube.com/@channel or video URL';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!validateUrl(url)) {
      setError(t('submit.invalidUrl'));
      return;
    }

    setLoading(true);
    onSubmit?.(url, mode);

    try {
      const res = await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, mode }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error?.message || data.error || t('submit.failed'));
        setLoading(false);
        return;
      }
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.networkError'));
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t('submit.urlLabel')}
        </label>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={getPlaceholder()}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          disabled={loading}
        />
        {error && <p className="text-sm text-red-600 mt-1">{error}</p>}
        <p className="mt-1 text-xs text-gray-400">
          {t('submit.urlHint')}
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Mode</label>
        <div className="flex gap-2">
          {[
            { id: 'robot', label: 'Robot', desc: t('submit.modeRobot') },
            { id: 'creator', label: 'Creator', desc: t('submit.modeCreator') },
            { id: 'ugc', label: 'UGC', desc: t('submit.modeUgc') },
          ].map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              disabled={loading}
              className={`flex-1 p-3 rounded-lg border text-left transition-colors ${
                mode === m.id
                  ? 'border-primary-500 bg-primary-50'
                  : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              <div className="font-medium text-sm">{m.label}</div>
              <div className="text-xs text-gray-500">{m.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full py-2.5 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors disabled:opacity-50"
      >
        {loading ? t('submit.processing') : t('submit.analyze')}
      </button>
    </form>
  );
}
