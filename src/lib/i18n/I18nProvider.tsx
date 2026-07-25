'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import type { Lang } from './translations';

interface I18nContextType {
  lang: Lang;
  setLang: (lang: Lang) => void;
  toggleLang: () => void;
}

// Chinese-first, matching getLang(). A component rendered outside the provider
// used to silently fall back to English on a Chinese-first product.
const I18nContext = createContext<I18nContextType>({
  lang: 'zh',
  setLang: () => {},
  toggleLang: () => {},
});

const COOKIE_NAME = 'nanosparks_lang';

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`));
  return match ? decodeURIComponent(match[2]) : null;
}

function setCookie(name: string, value: string) {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${365 * 24 * 60 * 60}; SameSite=Lax`;
}

export function I18nProvider({ children, serverLang }: { children: ReactNode; serverLang?: Lang }) {
  const [lang, setLangState] = useState<Lang>(() => {
    if (serverLang) return serverLang;
    const saved = getCookie(COOKIE_NAME);
    if (saved === 'zh' || saved === 'en') return saved;
    const browserLang =
      typeof navigator !== 'undefined' && !navigator.language.startsWith('zh') ? 'en' : 'zh';
    setCookie(COOKIE_NAME, browserLang);
    return browserLang;
  });

  const setLang = useCallback((newLang: Lang) => {
    setLangState(newLang);
    setCookie(COOKIE_NAME, newLang);
  }, []);

  const toggleLang = useCallback(() => {
    setLangState((prev) => {
      const next = prev === 'en' ? 'zh' : 'en';
      setCookie(COOKIE_NAME, next);
      return next;
    });
  }, []);

  return (
    <I18nContext.Provider value={{ lang, setLang, toggleLang }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
