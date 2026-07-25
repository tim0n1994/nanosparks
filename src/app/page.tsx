import { cookies } from 'next/headers';
import Navbar from '@/components/ui/Navbar';
import SubmitBox from '@/components/reader/SubmitBox';
import { getLang, t } from '@/lib/i18n/getLang';

export default async function HomePage() {
  const lang = getLang((await cookies()).toString());

  return (
    <div className="min-h-[100dvh] bg-surface">
      <Navbar />
      <main id="main" className="flex flex-col items-center justify-center px-5 pt-[18vh] pb-20">
        <div className="w-full max-w-form">
          {/* Eyebrow */}
          <p className="mb-3 text-sm font-medium text-link">{t('home.eyebrow', lang)}</p>

          {/* Headline */}
          <h1 className="mb-2 text-3xl font-semibold leading-[1.15] tracking-tight text-ink">
            {t('home.headline1', lang)}
            <br />
            <span className="text-ink-muted">{t('home.headline2', lang)}</span>
          </h1>

          <p className="mb-8 text-base leading-relaxed text-ink-muted">{t('home.platforms', lang)}</p>

          {/* Submit box */}
          <SubmitBox />
        </div>
      </main>
    </div>
  );
}
