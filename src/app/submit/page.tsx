import { cookies } from 'next/headers';
import Navbar from '@/components/ui/Navbar';
import SubmitBox from '@/components/reader/SubmitBox';
import { getLang, t } from '@/lib/i18n/getLang';

export default async function SubmitPage() {
  const lang = getLang((await cookies()).toString());

  return (
    <div className="min-h-[100dvh] bg-[#fafaf9]">
      <Navbar />
      <main className="flex flex-col items-center px-5 pt-[14vh] pb-20">
        <div className="w-full max-w-[580px]">
          <h1 className="mb-6 text-[24px] font-semibold tracking-tight text-zinc-900">
            {t('submit.title', lang)}
          </h1>
          <SubmitBox />
        </div>
      </main>
    </div>
  );
}
