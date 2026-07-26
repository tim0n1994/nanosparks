/**
 * Dev utility: re-enqueue the ingest job for pending conversations that have
 * no turns and no queued jobs (e.g. the API enqueued while its redis
 * connection was dead). Rebuilds the IngestResolverPayload from the
 * conversation's Source + GlobalEpisode rows.
 * Usage: npx tsx scripts/dev-requeue-ingest.ts [conversationId ...]
 */
import { config as loadEnv } from 'dotenv';
loadEnv();
import { prisma } from '@/lib/prisma';
import { ingestQueue } from '@/lib/queue/config';

async function main() {
  const ids = process.argv.slice(2);
  const convos = await prisma.conversation.findMany({
    where: ids.length
      ? { id: { in: ids } }
      : { status: 'pending', turns: { none: {} } },
    select: {
      id: true, title: true,
      source: { select: { uri: true } },
      globalEpisode: { select: { audioUrl: true, sourceUrl: true, episodeKey: true, platform: true, title: true } },
    },
  });
  const out = [];
  for (const c of convos) {
    const ge = c.globalEpisode;
    const audioUrl = ge?.audioUrl ?? ge?.sourceUrl ?? c.source?.uri;
    if (!ge || !audioUrl) {
      out.push({ id: c.id, skipped: 'missing globalEpisode/audioUrl' });
      continue;
    }
    const job = await ingestQueue.add('ingest', {
      conversationId: c.id,
      episodeKey: ge.episodeKey,
      audioUrl,
      sourceUrl: ge.sourceUrl ?? c.source?.uri ?? audioUrl,
      platform: ge.platform,
      title: ge.title ?? c.title ?? '',
      mode: 'robot',
    });
    out.push({ id: c.id, title: (c.title ?? '').slice(0, 36), jobId: job.id });
  }
  console.log(JSON.stringify(out, null, 1));
  await prisma.$disconnect();
  process.exit(0); // ingestQueue keeps an ioredis handle open; exit explicitly
}

main().catch((e) => { console.error(String(e)); process.exit(1); });
