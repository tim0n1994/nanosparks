import { cookies } from 'next/headers';
import Navbar from '@/components/ui/Navbar';
import ChannelForm from '@/components/ui/ChannelForm';
import { getLang, t } from '@/lib/i18n/getLang';

export default async function SubmitPage() {
  const lang = getLang((await cookies()).toString());

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-xl mx-auto px-4 py-12">
        <div className="bg-white rounded-xl border border-gray-200 p-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">{t('submit.title', lang)}</h1>
          <p className="text-gray-500 mb-6">
            {t('submit.subtitle', lang)}
          </p>
          <ChannelForm />
        </div>
      </main>
    </div>
  );
}
