import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseConfig, expectedMetrics, seal, inventory, inventoryHash, digest } from '../src/policy.mjs';

export const evidence = resolve('.omo/evidence');
mkdirSync(evidence, { recursive: true, mode: 0o700 });
export function fixtureDir(name) { return mkdtempSync(join(evidence, `${name}-`)); }
export function capture(name, facts) {
  const path = join(evidence, `${name}.json`);
  writeFileSync(path, JSON.stringify({ scenario: name, invocation: 'npm run verify', binary_observable: 'all scenario assertions passed', observed_at: new Date().toISOString(), ...facts }, null, 2) + '\n', { mode: 0o600 });
  console.log(`EVIDENCE ${path}`);
}
export function source(id, kind = 'postgres', enabled = true) {
  if (kind === 'rss') return { id, revision: 1, kind, enabled, feeds: [{ url: `https://feeds.example.invalid/${id}.rss` }] };
  const p = `NS_MCP_${id.toUpperCase().replaceAll('-', '_')}`;
  if (kind === 'podcastindex') return { id, revision: 1, kind, enabled, env: { apiKey: `${p}_API_KEY`, apiSecret: `${p}_API_SECRET` }, maxResults: 20 };
  return { id, revision: 1, kind, enabled, tls: 'loopback', env: { host: `${p}_HOST`, port: `${p}_PORT`, username: `${p}_USER`, password: `${p}_PASSWORD`, ...(kind === 'postgres' ? { database: `${p}_DB` } : {}) }, ...(kind === 'redis' ? { queues: ['ingest', 'analyze'] } : {}) };
}
export function configuration(sources = [source('alpha'), source('beta', 'postgres', false), source('queues', 'redis')]) {
  return parseConfig({ version: 1, citationOrigin: 'https://nanosparks-mcp.example.invalid', refreshSeconds: 60, staleSeconds: 120, sources, http: { host: '127.0.0.1', port: 17558, tokenEnv: 'NS_MCP_HTTP_TOKEN', allowedOrigins: ['https://chatgpt.com'], concurrency: 2, requestsPerMinute: 120 } });
}
export function fixtureEnvironment(config) {
  return Object.fromEntries(config.sources.flatMap(s => Object.entries(s.env ?? {}).map(([field, ref]) => [ref, { host: '127.0.0.1', port: '1', username: s.kind === 'postgres' ? 'nanosparks_mcp_reader' : 'nanosparks_mcp_counts', password: 'fixture-only-not-a-real-credential', database: 'fixture', apiKey: 'fixture-key-12345678', apiSecret: 'abcdef1234567890' }[field]])));
}
export function snapshot(config, now = Date.now(), value = 7) {
  const date = new Date(now).toISOString();
  const rssValues = { 'rss.feeds': 1, 'rss.feeds_ok': 1, 'rss.episodes': 3, 'rss.episodes_with_transcript': 2, 'rss.transcripts_fetched': 1 };
  return seal({ version: 2, started_at: date, generated_at: date, duration_ms: 0, refresh_seconds: 60, stale_after_seconds: 120, inventory_hash: inventoryHash(config), sources: config.sources.map(s => seal({
    id: s.id, kind: s.kind, enabled: s.enabled, generated_at: date,
    source_revision: s.revision, provenance_hash: digest(inventory(config).find(v => v.id === s.id)),
    scope: s.kind === 'postgres' ? 'database_aggregate_counts' : s.kind === 'rss' ? 'public_feed_transcripts' : s.kind === 'podcastindex' ? 'podcast_index_discovery' : 'configured_bullmq_keys',
    status: s.enabled ? s.kind === 'redis' ? 'UNKNOWN' : 'OK' : 'DISABLED', reason: s.enabled ? s.kind === 'redis' ? 'ADMISSION_UNVERIFIED' : 'NONE' : 'DISABLED',
    accuracy: s.enabled && (s.kind === 'postgres' || s.kind === 'rss' || s.kind === 'podcastindex') ? 'exact' : 'unavailable', consistency: s.kind === 'postgres' ? 'repeatable_read' : s.kind === 'rss' ? 'bounded_fetch' : s.kind === 'podcastindex' ? 'authenticated_api' : 'per_command',
    metrics: s.enabled && (s.kind === 'postgres' || s.kind === 'rss' || s.kind === 'podcastindex') ? expectedMetrics(s).map(metric => ({ metric, value: s.kind === 'rss' ? rssValues[metric] : value })) : [],
    ...(s.enabled && s.kind === 'rss' ? { documents: [{ feed_url: s.feeds[0].url, episode_title: 'Fixture episode', transcript_url: `https://feeds.example.invalid/${s.id}/ep1.vtt`, transcript_type: 'text/vtt', bytes: 128, sha256: 'a'.repeat(64), fetched_at: date }] } : {})
  })) });
}
export function reseal(raw) {
  const { hash, ...body } = raw; void hash;
  body.sources = body.sources.map(({ hash, ...s }) => { void hash; return seal(s); });
  return seal(body);
}
