'use client';

import { useCallback } from 'react';
import { useI18n } from './I18nProvider';
import { translations } from './translations';

export type TFunction = (key: string, params?: Record<string, string | number>) => string;

/**
 * Client-side translation bound to the current language.
 *
 * `t` is memoised on `lang`: it lands in the dependency array of most callbacks
 * and effects in the reader, and an unstable identity there re-subscribes SSE
 * streams and re-runs observers on every render.
 */
export function useTranslation() {
  const { lang, toggleLang, setLang } = useI18n();

  const t: TFunction = useCallback(
    (key, params) => {
      const dict = lang === 'zh' ? translations.zh : translations.en;
      // Fall back to zh, not en — this is a Chinese-first product, so a key
      // that only exists in one place is far likelier to exist in zh.
      let text = dict[key] ?? translations.zh[key] ?? key;
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          text = text.replace(`{${k}}`, String(v));
        }
      }
      return text;
    },
    [lang],
  );

  return { t, lang, toggleLang, setLang };
}
