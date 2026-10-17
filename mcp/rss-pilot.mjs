import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { rssCollect, collect } from './src/collect.mjs';
import { parseConfig, validateSnapshot } from './src/policy.mjs';
import { Audit } from './src/audit.mjs';
import { createService } from './src/service.mjs';
import { fixtureDir } from './test/helpers.mjs';
import assert from 'node:assert/strict';

const sourceConfig = { id: 'podnews-pilot', revision: 1, kind: 'rss', enabled: true, feeds: [{ url: 'https://podnews.net/rss' }] };
const config = parseConfig({ version: 1, citationOrigin: 'https://nanosparks-mcp.example.invalid', refreshSeconds: 300, staleSeconds: 900, sources: [sourceConfig] });
const direct = await rssCollect(config.sources[0], {}, undefined, {});
assert.equal(direct.metrics.find(m => m.metric === 'rss.feeds_ok').value, 1);
assert.ok(direct.metrics.find(m => m.metric === 'rss.transcripts_fetched').value >= 1, 'no transcript fetched');
const dir = fixtureDir('rss-pilot');
const audit = new Audit(join(dir, 'audit.jsonl'));
const snapshot = await collect(config, dir, { audit });
audit.close();
validateSnapshot(snapshot, config);
const service = createService(config, snapshot);
const overview = service.invoke('overview', {});
const search = service.invoke('search', { query: 'rss' });
const document = service.invoke('fetch', { id: search.results[0].id });
assert.equal(document.title, 'RSS transcript evidence');
const evidence = {
  scenario: 'rss-pilot',
  invocation: 'node rss-pilot.mjs',
  production: false,
  live_network: true,
  feed: sourceConfig.feeds[0].url,
  direct_metrics: Object.fromEntries(direct.metrics.map(m => [m.metric, m.value])),
  documents: direct.documents,
  snapshot_hash: snapshot.hash,
  snapshot_source_status: snapshot.sources[0].status,
  snapshot_metrics: Object.fromEntries(snapshot.sources[0].metrics.map(m => [m.metric, m.value])),
  snapshot_documents: snapshot.sources[0].documents,
  tool_overview_ok: overview.ok,
  tool_search_results: search.results.length,
  tool_fetch_title: document.title,
  observed_at: new Date().toISOString()
};
writeFileSync('.omo/evidence/rss-pilot.json', JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
console.log('PILOT OK', JSON.stringify({ metrics: evidence.direct_metrics, docs: direct.documents.map(d => ({ title: d.episode_title, bytes: d.bytes, url: d.transcript_url })) }));
