import { cookies } from 'next/headers';
import Navbar from '@/components/ui/Navbar';
import SubmitBox from '@/components/reader/SubmitBox';
import { getLang, t } from '@/lib/i18n/getLang';

export default async function SubmitPage() {
  const lang = getLang((await cookies()).toString());

  return (
    <div className="min-h-[100dvh] bg-surface">
      <Navbar />
      <main id="main" className="flex flex-col items-center px-5 pt-[14vh] pb-20">
        <div className="w-full max-w-form">
          <h1 className="mb-6 text-2xl font-semibold tracking-tight text-ink">
            {t('submit.title', lang)}
          </h1>
          <SubmitBox />
        </div>
      </main>
    </div>
  );
}
