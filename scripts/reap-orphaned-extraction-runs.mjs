#!/usr/bin/env node
import pg from 'pg';

const ORPHAN_AFTER = '48 hours';
const MARK = 'orphaned_running_reaped';

function parseArgs(argv) {
  const apply = argv.includes('--apply');
  if (argv.some(a => a !== '--apply')) throw new Error('usage: node scripts/reap-orphaned-extraction-runs.mjs [--apply]');
  return { apply };
}

async function main() {
  const { apply } = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const candidates = await client.query(
      "SELECT id, kind, model, \"startedAt\", (extract(epoch from now() - \"startedAt\")/3600)::int AS age_hours FROM public.\"ExtractionRun\" WHERE status = 'running' AND \"startedAt\" < now() - ($1)::interval ORDER BY \"startedAt\"",
      [ORPHAN_AFTER]
    );
    if (!apply) {
      console.log(JSON.stringify({ mode: 'dry-run', orphans: candidates.rows.length, rows: candidates.rows }));
      return;
    }
    const applied = await client.query(
      "UPDATE public.\"ExtractionRun\" SET status = 'failed', \"finishedAt\" = now(), params = COALESCE(params, '{}'::jsonb) || ($2)::jsonb WHERE status = 'running' AND \"startedAt\" < now() - ($1)::interval",
      [ORPHAN_AFTER, JSON.stringify({ recovery: MARK, recoveredAt: new Date().toISOString() })]
    );
    console.log(JSON.stringify({ mode: 'apply', marked: MARK, updated: applied.rowCount }));
  } finally {
    await client.end();
  }
}

main().catch(error => {
  process.stderr.write(String(error?.message ?? error) + String.fromCharCode(10));
  process.exitCode = 1;
});
