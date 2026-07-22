import { cookies } from 'next/headers';
import Link from 'next/link';
import Navbar from '@/components/ui/Navbar';
import RetryButton from '@/components/dashboard/RetryButton';
import { prisma } from '@/lib/prisma';
import { getLang, t } from '@/lib/i18n/getLang';

export const dynamic = 'force-dynamic';

const STATUS_STYLES: Record<string, string> = {
  completed: 'bg-emerald-50 text-emerald-700',
  transcribed: 'bg-emerald-50 text-emerald-700',
  transcribing: 'bg-amber-50 text-amber-700',
  processing: 'bg-amber-50 text-amber-700',
  analyzing: 'bg-amber-50 text-amber-700',
  pending: 'bg-zinc-100 text-zinc-500',
  failed: 'bg-red-50 text-red-600',
};

const STATUS_LABELS: Record<string, string> = {
  completed: '已就绪',
  transcribed: '已转写',
  transcribing: '转写中',
  processing: '处理中',
  analyzing: '分析中',
  pending: '排队中',
  failed: '失败',
};

export default async function DashboardPage() {
  const lang = getLang((await cookies()).toString());

  const [corpora, recentConversations] = await Promise.all([
    prisma.corpus.findMany({
      include: {
        _count: { select: { conversations: true } },
        conversations: { select: { id: true, status: true }, take: 100 },
      },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.conversation.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 15,
      include: { corpus: { select: { name: true } }, source: { select: { id: true, status: true } } },
    }),
  ]);

  const total = recentConversations.length;
  const ready = recentConversations.filter((c) => ['completed', 'transcribed'].includes(c.status)).length;
  const processing = recentConversations.filter((c) => ['pending', 'transcribing', 'analyzing', 'processing'].includes(c.status)).length;
  const failed = recentConversations.filter((c) => c.status === 'failed').length;

  return (
    <div className="min-h-[100dvh] bg-[#fafaf9]">
      <Navbar />
      <main className="mx-auto max-w-[1100px] px-5 py-8">
        <h1 className="mb-6 text-[20px] font-semibold tracking-tight text-zinc-900">
          {t('dashboard.title', lang)}
        </h1>

        {/* Stats row */}
        <div className="mb-8 grid grid-cols-4 gap-3">
          {[
            { label: '全部', value: total, color: 'text-zinc-900' },
            { label: '可读', value: ready, color: 'text-emerald-600' },
            { label: '处理中', value: processing, color: 'text-amber-600' },
            { label: '失败', value: failed, color: 'text-red-500' },
          ].map((stat) => (
            <div key={stat.label} className="rounded-lg border border-zinc-200 bg-white px-4 py-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">{stat.label}</p>
              <p className={`mt-1 text-[24px] font-semibold tabular-nums ${stat.color}`}>{stat.value}</p>
            </div>
          ))}
        </div>

        {/* Recent activity */}
        <div>
          <h2 className="section-label mb-3">最近</h2>
          <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
            {recentConversations.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <p className="text-[14px] text-zinc-400">还没有内容</p>
                <Link href="/submit" className="mt-2 inline-block text-[13px] font-medium text-accent-600 hover:underline">
                  贴一条链接试试 →
                </Link>
              </div>
            ) : (
              <div className="divide-y divide-zinc-100">
                {recentConversations.map((conv) => (
                  <div key={conv.id} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-zinc-50">
                    <div className="min-w-0 flex-1">
                      <Link href={`/read/${conv.id}`} className="block truncate text-[14px] font-medium text-zinc-800 hover:text-accent-600">
                        {conv.title || '未命名'}
                      </Link>
                      <p className="mt-0.5 font-mono text-[11px] text-zinc-400">
                        {conv.updatedAt.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        {conv.corpus?.name ? ` · ${conv.corpus.name}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[conv.status] || STATUS_STYLES.pending}`}>
                        {STATUS_LABELS[conv.status] || conv.status}
                      </span>
                      {conv.status === 'failed' && conv.source && <RetryButton sourceId={conv.source.id} />}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
