import { translations, type Lang, type TranslationKey } from './translations';

/** Server-safe: read lang from cookie value */
export function getLang(cookie?: string): Lang {
  if (!cookie) return 'en';
  const match = cookie.match(new RegExp(`(?:^|;\\s*)nanosparks_lang=([^;]+)`));
  const val = match ? decodeURIComponent(match[1]) : '';
  return val === 'zh' || val === 'en' ? val : 'en';
}

/** Get a translated string by key (for server components) */
export function t(key: string, lang: Lang, params?: Record<string, string | number>): string {
  const enDict = translations.en;
  const zhDict = translations.zh;

  // Check if key exists
  if (!(key in enDict)) {
    return key;
  }

  let text = lang === 'zh' ? zhDict[key] : enDict[key];
  if (!text) text = enDict[key] || key;

  // Replace params like {count}, {name}, etc.
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, String(v));
    }
  }

  return text;
}

export { translations };
export type { Lang, TranslationKey };
