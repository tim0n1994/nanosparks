'use client';

import { useI18n } from '@/lib/i18n/I18nProvider';

export default function LangToggle() {
  const { lang, toggleLang } = useI18n();

  return (
    <button
      onClick={toggleLang}
      className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-500 hover:text-gray-700 hover:border-gray-300 transition-colors font-medium"
      title={lang === 'en' ? 'Switch to Chinese' : '切换到英文'}
    >
      {lang === 'en' ? '中文' : 'EN'}
    </button>
  );
}
