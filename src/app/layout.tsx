import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { cookies } from 'next/headers';
import { getLang } from '@/lib/i18n/getLang';
import ClerkProviderWrapper from '@/components/ClerkProviderWrapper';
import { I18nProvider } from '@/lib/i18n/I18nProvider';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'NanoSparks - Conversational Intelligence',
  description: 'Turn podcasts into interactive idea maps',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const lang = getLang(cookies().toString());

  return (
    <ClerkProviderWrapper>
      <html lang={lang === 'zh' ? 'zh-CN' : 'en'}>
        <body className={inter.className}>
          <I18nProvider serverLang={lang}>{children}</I18nProvider>
        </body>
      </html>
    </ClerkProviderWrapper>
  );
}
