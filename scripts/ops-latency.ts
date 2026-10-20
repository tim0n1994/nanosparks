/**
 * Ops: latency distribution of the submit → readable → 导读 pipeline (T2).
 *
 * Read-only. Usage: `npx tsx scripts/ops-latency.ts [days]` (default 30).
 * Only real (non-synthetic) conversations with the 2026-10-19 stage
 * timestamps are counted — historical rows without them are excluded.
 */
import { config as loadEnv } from 'dotenv';
loadEnv();
import { prisma } from '@/lib/prisma';

async function main() {
  const days = Number(process.argv[2] ?? 30);

  const summary = await prisma.$queryRawUnsafe<Array<{
    conversations: number; with_readable: number; with_analyzed: number;
    p50_to_readable_s: number | null; p90_to_readable_s: number | null;
    p50_to_analyzed_s: number | null; p90_to_analyzed_s: number | null;
  }>>(`
    WITH c AS (
      SELECT "createdAt", "transcribedAt", "analyzedAt",
             EXTRACT(EPOCH FROM ("transcribedAt" - "createdAt")) AS to_readable_s,
             EXTRACT(EPOCH FROM ("analyzedAt" - "transcribedAt")) AS to_analyzed_s
      FROM "Conversation"
      WHERE "createdAt" >= NOW() - make_interval(days => $1::int)
        AND "isSynthetic" = false
    )
    SELECT count(*)::int AS conversations,
           count("transcribedAt")::int AS with_readable,
           count("analyzedAt")::int AS with_analyzed,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY to_readable_s) AS p50_to_readable_s,
           percentile_cont(0.9) WITHIN GROUP (ORDER BY to_readable_s) AS p90_to_readable_s,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY to_analyzed_s) AS p50_to_analyzed_s,
           percentile_cont(0.9) WITHIN GROUP (ORDER BY to_analyzed_s) AS p90_to_analyzed_s
    FROM c`, days);

  console.log(`pipeline latency — last ${days} days (real conversations only)`);
  console.log(JSON.stringify(summary[0], null, 2));

  const recent = await prisma.$queryRawUnsafe<Array<{
    id: string; title: string | null; status: string;
    createdAt: Date; transcribedAt: Date | null; analyzedAt: Date | null;
  }>>(`
    SELECT id, left(title, 42) AS title, status, "createdAt", "transcribedAt", "analyzedAt"
    FROM "Conversation"
    WHERE "createdAt" >= NOW() - make_interval(days => $1::int) AND "isSynthetic" = false
    ORDER BY "createdAt" DESC
    LIMIT 20`, days);

  const mins = (a: Date, b: Date) => ((a.getTime() - b.getTime()) / 60_000).toFixed(1);
  for (const r of recent) {
    const toReadable = r.transcribedAt ? mins(r.transcribedAt, r.createdAt) : '—';
    const toAnalyzed = r.analyzedAt && r.transcribedAt ? mins(r.analyzedAt, r.transcribedAt) : '—';
    console.log(`${r.createdAt.toISOString()}  ${r.status.padEnd(12)} submit→readable ${String(toReadable).padStart(6)}m  readable→导读 ${String(toAnalyzed).padStart(6)}m  ${r.title ?? r.id}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
