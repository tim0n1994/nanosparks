/**
 * Home = the product entry (PRD §2.3 提交页：首页一个大输入框).
 *
 * Per the build guidance ("should not make a landing page unless absolutely
 * required; build the actual usable experience as the first screen"), the home
 * page IS the submit experience — a large input box front and center, not a
 * marketing hero. Marketing copy lives elsewhere.
 */

import { cookies } from 'next/headers';
import Navbar from '@/components/ui/Navbar';
import SubmitBox from '@/components/reader/SubmitBox';
import { getLang, t } from '@/lib/i18n/getLang';

export default async function HomePage() {
  const lang = getLang((await cookies()).toString());

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-xl mx-auto w-full px-4 py-16">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-3">{t('home.title', lang)}</h1>
          <p className="text-gray-500">{t('submit.subtitle', lang)}</p>
        </div>
        <SubmitBox />
      </main>
    </div>
  );
}
