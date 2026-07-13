import { cookies } from 'next/headers';
import Link from 'next/link';
import Navbar from '@/components/ui/Navbar';
import EmptyState from '@/components/ui/EmptyState';
import { prisma } from '@/lib/prisma';
import { getLang, t } from '@/lib/i18n/getLang';

export const dynamic = 'force-dynamic';

export default async function CorporaListPage() {
  const lang = getLang(cookies().toString());

  const corpora = await prisma.corpus.findMany({
    include: {
      _count: { select: { conversations: true, sources: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">{t('corpora.title', lang)}</h1>
        <p className="text-gray-500 mb-6">
          {t('corpora.subtitle', lang)}
        </p>

        {corpora.length === 0 ? (
          <EmptyState
            title={t('corpora.empty.title', lang)}
            description={t('corpora.empty.desc', lang)}
            action={<Link href="/submit" className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium">{t('error.analyzeNow', lang)}</Link>}
          />
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {corpora.map((corpus) => (
              <Link
                key={corpus.id}
                href={`/corpora/${corpus.id}`}
                className="bg-white rounded-lg border border-gray-200 p-5 hover:shadow-md transition-shadow group"
              >
                <h3 className="font-semibold text-gray-900 group-hover:text-primary-600 transition-colors">
                  {corpus.name}
                </h3>
                {corpus.description && (
                  <p className="text-sm text-gray-500 mt-1 line-clamp-2">{corpus.description}</p>
                )}
                <div className="flex gap-3 mt-3 text-xs text-gray-400">
                  <span>{t('corpora.conversations', lang, { count: corpus._count.conversations })}</span>
                  <span>·</span>
                  <span>{t('corpora.sources', lang, { count: corpus._count.sources })}</span>
                </div>
              </Link>
            ))}
          </div>
        )}

        <div className="mt-8 bg-white rounded-lg border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">{t('corpora.aboutModes', lang)}</h2>
          <div className="space-y-3 text-sm text-gray-600">
            <div className="flex items-start gap-3">
              <span className="text-base mt-0.5">🔤</span>
              <div>
                <span className="font-medium text-gray-800">{t('corpora.mode.keyword', lang)}</span> — {t('corpora.mode.keywordDesc', lang)}
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-base mt-0.5">🧠</span>
              <div>
                <span className="font-medium text-gray-800">{t('corpora.mode.semantic', lang)}</span> — {t('corpora.mode.semanticDesc', lang)}
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-base mt-0.5">⚡</span>
              <div>
                <span className="font-medium text-gray-800">{t('corpora.mode.hybrid', lang)}</span> — {t('corpora.mode.hybridDesc', lang)}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
