import { cookies } from 'next/headers';
import Navbar from '@/components/ui/Navbar';
import SubmitBox from '@/components/reader/SubmitBox';
import { getLang, t } from '@/lib/i18n/getLang';

export default async function SubmitPage() {
  const lang = getLang((await cookies()).toString());

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-xl mx-auto w-full px-4 py-16">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-3">{t('submit.title', lang)}</h1>
          <p className="text-gray-500">{t('submit.subtitle', lang)}</p>
        </div>
        <SubmitBox />
      </main>
    </div>
  );
}
