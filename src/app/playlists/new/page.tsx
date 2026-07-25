'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/ui/Navbar';
import { useTranslation } from '@/lib/i18n/useTranslation';

export default function NewPlaylistPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: description || undefined }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error?.message || t('playlist.new.error'));
        setLoading(false);
        return;
      }
      router.push('/playlists');
    } catch (err) {
      setError(t('common.networkError'));
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-surface">
      <Navbar />
      <main id="main" className="max-w-xl mx-auto px-4 py-12">
        <div className="bg-surface-raised rounded-xl border border-line p-8">
          <h1 className="text-2xl font-bold text-ink mb-2">{t('playlist.new.title')}</h1>
          <p className="text-ink-muted mb-6">{t('playlist.new.desc')}</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-ink-subtle mb-1">{t('playlist.new.name')}</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('playlist.new.namePlaceholder')}
                className="w-full px-3 py-2 border border-line rounded-lg focus:ring-2 focus:ring-accent-500 focus:border-transparent"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-ink-subtle mb-1">{t('playlist.new.description')}</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('playlist.new.descPlaceholder')}
                rows={3}
                className="w-full px-3 py-2 border border-line rounded-lg focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => router.back()}
                className="flex-1 py-2.5 border border-line text-ink-subtle rounded-lg font-medium hover:bg-surface-sunken transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 py-2.5 bg-accent-600 text-white rounded-lg font-medium hover:bg-accent-700 transition-colors disabled:opacity-50"
              >
                {loading ? t('playlist.new.creating') : t('playlist.new.create')}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
