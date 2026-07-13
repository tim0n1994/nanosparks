'use client';

import { useI18n } from './I18nProvider';
import { translations, type TranslationKey } from './translations';

/** Client-side: translate a key using the current language from context */
export function useTranslation() {
  const { lang, toggleLang, setLang } = useI18n();

  const t = (key: string, params?: Record<string, string | number>): string => {
    const dict = lang === 'zh' ? translations.zh : translations.en;
    let text = dict[key];
    if (!text) text = (translations.en as Record<string, string>)[key] || key;

    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(`{${k}}`, String(v));
      }
    }

    return text;
  };

  return { t, lang, toggleLang, setLang };
}
