import { cookies } from 'next/headers';
import Link from 'next/link';
import Navbar from '@/components/ui/Navbar';
import EmptyState from '@/components/ui/EmptyState';
import { prisma } from '@/lib/prisma';
import { getLang, t } from '@/lib/i18n/getLang';

export const dynamic = 'force-dynamic';

export default async function CorporaListPage() {
  const lang = getLang((await cookies()).toString());

  const corpora = await prisma.corpus.findMany({
    include: {
      _count: { select: { conversations: true, sources: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <div className="min-h-[100dvh] bg-surface">
      <Navbar />
      <main id="main" className="mx-auto max-w-app px-5 py-8">
        <h1 className="text-2xl font-bold text-ink mb-2">{t('corpora.title', lang)}</h1>
        <p className="text-ink-muted mb-6">
          {t('corpora.subtitle', lang)}
        </p>

        {corpora.length === 0 ? (
          <EmptyState
            title={t('corpora.empty.title', lang)}
            description={t('corpora.empty.desc', lang)}
            action={<Link href="/submit" className="px-4 py-2 bg-accent-600 text-white rounded-lg text-sm font-medium">{t('shelf.empty.cta', lang)}</Link>}
          />
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {corpora.map((corpus) => (
              <Link
                key={corpus.id}
                href={`/corpora/${corpus.id}`}
                className="bg-surface-raised rounded-lg border border-line p-5 hover:shadow-md transition-shadow group"
              >
                <h3 className="font-semibold text-ink group-hover:text-link transition-colors">
                  {corpus.name}
                </h3>
                {corpus.description && (
                  <p className="text-sm text-ink-muted mt-1 line-clamp-2">{corpus.description}</p>
                )}
                <div className="flex gap-3 mt-3 text-xs text-ink-muted">
                  <span>{t('corpora.conversations', lang, { count: corpus._count.conversations })}</span>
                  <span>·</span>
                  <span>{t('corpora.sources', lang, { count: corpus._count.sources })}</span>
                </div>
              </Link>
            ))}
          </div>
        )}

        <div className="mt-8 bg-surface-raised rounded-lg border border-line p-5">
          <h2 className="text-sm font-semibold text-ink-subtle mb-3">{t('corpora.aboutModes', lang)}</h2>
          <div className="space-y-3 text-sm text-ink-subtle">
            <div className="flex items-start gap-3">
              <span className="text-base mt-0.5">🔤</span>
              <div>
                <span className="font-medium text-ink">{t('query.mode.keyword', lang)}</span> — {t('query.mode.keywordDesc', lang)}
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-base mt-0.5">🧠</span>
              <div>
                <span className="font-medium text-ink">{t('query.mode.semantic', lang)}</span> — {t('query.mode.semanticDesc', lang)}
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-base mt-0.5">⚡</span>
              <div>
                <span className="font-medium text-ink">{t('query.mode.hybrid', lang)}</span> — {t('query.mode.hybridDesc', lang)}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
