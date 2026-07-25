import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { cookies } from 'next/headers';
import { getLang, t } from '@/lib/i18n/getLang';
import ClerkProviderWrapper from '@/components/ClerkProviderWrapper';
import CommandPalette from '@/components/search/CommandPalette';
import { I18nProvider } from '@/lib/i18n/I18nProvider';
import { ToastProvider } from '@/components/ui/Toast';
import './globals.css';

/** Metadata follows the language cookie, so a shared link previews correctly. */
export async function generateMetadata(): Promise<Metadata> {
  const lang = getLang((await cookies()).toString());
  return {
    title: t('meta.title', lang),
    description: t('meta.description', lang),
    appleWebApp: { capable: true, statusBarStyle: 'default', title: 'NanoSparks' },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafaf9' },
    { media: '(prefers-color-scheme: dark)', color: '#09090b' },
  ],
};

/**
 * Runs before first paint so a dark-mode reader never sees a white flash.
 * Reads the same localStorage key as lib/reader-prefs and stamps data-theme
 * on <html>; the CSS token layer keys off that attribute.
 */
const THEME_SCRIPT = `(function(){try{
var p=localStorage.getItem('nanosparks:readerPrefs');
var dark=p?!!JSON.parse(p).darkMode:window.matchMedia('(prefers-color-scheme: dark)').matches;
if(dark)document.documentElement.setAttribute('data-theme','dark');
}catch(e){}})();`;

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const lang = getLang((await cookies()).toString());

  return (
    <ClerkProviderWrapper>
      <html lang={lang === 'en' ? 'en' : 'zh-CN'} suppressHydrationWarning>
        <head>
          <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        </head>
        <body className={`${GeistSans.variable} ${GeistMono.variable}`}>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:text-surface-raised"
          >
            {t('common.skipToContent', lang)}
          </a>
          <I18nProvider serverLang={lang}>
            <ToastProvider>
              {children}
              {/* V2/T-V2-9: global Cmd+K search palette */}
              <CommandPalette />
            </ToastProvider>
          </I18nProvider>
        </body>
      </html>
    </ClerkProviderWrapper>
  );
}
