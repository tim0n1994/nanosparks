import { cookies } from 'next/headers';
import Link from 'next/link';
import Navbar from '@/components/ui/Navbar';
import { getLang, t } from '@/lib/i18n/getLang';

export default async function HomePage() {
  const lang = getLang((await cookies()).toString());

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main>
        <section className="py-20 px-4">
          <div className="max-w-4xl mx-auto text-center">
            <h1 className="text-5xl font-bold text-gray-900 mb-6">
              {t('home.title', lang)}
              <span className="text-primary-600">{t('home.titleHighlight', lang)}</span>
            </h1>
            <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
              {t('home.subtitle', lang)}
            </p>
            <div className="flex gap-4 justify-center">
              <Link
                href="/submit"
                className="px-6 py-3 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors"
              >
                {t('home.analyzeCta', lang)}
              </Link>
              <Link
                href="/dashboard"
                className="px-6 py-3 bg-white text-gray-700 rounded-lg font-medium border border-gray-200 hover:bg-gray-50 transition-colors"
              >
                {t('home.seeDemo', lang)}
              </Link>
            </div>
          </div>
        </section>

        <section className="py-16 px-4 bg-white">
          <div className="max-w-6xl mx-auto">
            <div className="grid md:grid-cols-3 gap-8">
              {[
                {
                  key: 'feature1',
                  icon: '⚡',
                },
                {
                  key: 'feature2',
                  icon: '🕸️',
                },
                {
                  key: 'feature3',
                  icon: '🔗',
                },
              ].map((feature) => (
                <div key={feature.key} className="text-center p-6">
                  <div className="text-4xl mb-4">{feature.icon}</div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">
                    {t(`home.${feature.key}.title`, lang)}
                  </h3>
                  <p className="text-gray-600">{t(`home.${feature.key}.desc`, lang)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
