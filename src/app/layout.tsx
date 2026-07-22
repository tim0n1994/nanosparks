import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { cookies } from 'next/headers';
import { getLang } from '@/lib/i18n/getLang';
import ClerkProviderWrapper from '@/components/ClerkProviderWrapper';
import { I18nProvider } from '@/lib/i18n/I18nProvider';
import './globals.css';

export const metadata: Metadata = {
  title: 'NanoSparks — 读播客',
  description: '贴一条播客链接，10分钟内变成可读、可信、可再创作的图文',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const lang = getLang((await cookies()).toString());

  return (
    <ClerkProviderWrapper>
      <html lang={lang === 'zh' ? 'zh-CN' : 'en'}>
        <body className={`${GeistSans.variable} ${GeistMono.variable}`}>
          <I18nProvider serverLang={lang}>{children}</I18nProvider>
        </body>
      </html>
    </ClerkProviderWrapper>
  );
}
