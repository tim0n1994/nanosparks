import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, statSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseConfig, validateSnapshot, credentials, MAX_SOURCES, expectedMetrics, inventory, inventoryHash, digest, seal } from '../src/policy.mjs';
import { publishSnapshot, loadSnapshot, readBounded } from '../src/files.mjs';
import { createService } from '../src/service.mjs';
import { Audit, Limits } from '../src/audit.mjs';
import { httpSettings } from '../src/transport.mjs';
import { configuration, source, snapshot, reseal, fixtureDir, fixtureEnvironment, capture } from './helpers.mjs';

test('strict config and dedicated credentials fail closed without app env fallback', () => {
  const config = configuration();
  for (const invalid of [
    { ...config, sources: Array.from({ length: MAX_SOURCES + 1 }, (_, i) => source(`s${i}`)) },
    { ...config, sources: [source('alpha'), source('alpha')] }, { ...config, refreshSeconds: 59 },
    { ...config, http: { ...config.http, host: '0.0.0.0' } },
    { ...config, http: { ...config.http, allowedOrigins: ['https://chatgpt.com/?token=bad'] } },
    { ...config, sources: [{ ...source('alpha'), url: 'postgres://raw-secret' }] },
    { ...config, sources: [{ ...source('alpha'), env: { ...source('alpha').env, password: 'DATABASE_URL' } }] }
  ]) assert.throws(() => parseConfig(invalid), /INVALID_CONFIG/);
  assert.throws(() => credentials(config.sources[0], { DATABASE_URL: 'app-account' }), /MISSING_CREDENTIAL/);
  const env = fixtureEnvironment(config);
  env[config.sources[0].env.username] = 'postgres';
  assert.throws(() => credentials(config.sources[0], env), /INVALID_CREDENTIAL_CONFIG/);
  assert.throws(() => httpSettings(config, {}), /INVALID_HTTP_CONFIG/);
  assert.throws(() => httpSettings(config, { NS_MCP_HTTP_TOKEN: 'short' }), /INVALID_HTTP_CONFIG/);
  capture('config-policy', { rejected_config_cases: 7, rejected_credentials: ['missing', 'app-role', 'missing-http', 'short-http'] });
});

test('hashes are not trust: reject rehashed PII, unknown fields, metrics, type coercion and scope substitution', () => {
  const config = configuration();
  const mutations = [
    s => { s.sources[0].error = 'PII_SENTINEL@example.invalid'; },
    s => { s.sources[0].metrics[0].value = 'PII_SENTINEL@example.invalid'; },
    s => { s.sources[0].metrics[0].metric = 'PII_SENTINEL'; },
    s => { s.sources[0].reason = 'PII_SENTINEL'; },
    s => { s.sources[0].id = 'unconfigured'; },
    s => { s.sources[0].metrics[0].value = -1; },
    s => { s.sources[0].metrics[0].value = Number.MAX_SAFE_INTEGER + 1; },
    s => { s.sources[0].metrics.pop(); },
    s => { s.sources[0].status = 'UNKNOWN'; },
    s => { s.sources.push(s.sources[0]); },
    s => { s.generated_at = new Date(Date.now() + 60000).toISOString(); }
  ];
  for (const mutate of mutations) { const raw = structuredClone(snapshot(config)); mutate(raw); assert.throws(() => validateSnapshot(reseal(raw), config), /INVALID_SNAPSHOT/); }
  const raw = snapshot(config); raw.sources[0].metrics[0].value++;
  assert.throws(() => validateSnapshot(raw, config), /INVALID_SNAPSHOT/);
  const good = validateSnapshot(snapshot(config), config);
  assert(Object.isFrozen(good.sources[0].metrics[0]));
capture('snapshot-redaction', { rejected_tamper_cases: mutations.length + 1, deeply_frozen: true });
});

test('snapshot v2 contract binds capture window, freshness budget and sanitized redis diagnostics', () => {
  const config = configuration();
  for (const mutate of [
    s => { delete s.started_at; },
    s => { s.duration_ms = 1; },
    s => { s.refresh_seconds = 61; },
    s => { s.stale_after_seconds = 121; },
    s => { s.started_at = new Date(Date.parse(s.generated_at) + 1000).toISOString(); },
    s => { s.version = 1; }
  ]) { const raw = structuredClone(snapshot(config)); mutate(raw); assert.throws(() => validateSnapshot(reseal(raw), config), /INVALID_SNAPSHOT/); }
  const redisConfig = configuration([{ ...source('q1', 'redis'), queues: ['ingest'] }]);
  const at = new Date().toISOString();
  const redisSource = () => seal({
    id: 'q1', kind: 'redis', enabled: true, source_revision: 1, provenance_hash: digest(inventory(redisConfig)[0]),
    generated_at: at, scope: 'configured_bullmq_keys', status: 'OK', reason: 'NONE', accuracy: 'exact', consistency: 'per_command',
    metrics: expectedMetrics(redisConfig.sources[0]).map(metric => ({ metric, value: 1 })),
    diagnostics: [{ queue: 'ingest', waiting_children_oldest_ms: 65000, last_event_age_ms: 2000, failed_classes: [{ class: 'connection', count: 1 }] }]
  });
  const v2 = () => seal({ version: 2, started_at: at, generated_at: at, duration_ms: 0, refresh_seconds: 60, stale_after_seconds: 120, inventory_hash: inventoryHash(redisConfig), sources: [redisSource()] });
  assert.equal(validateSnapshot(v2(), redisConfig).sources[0].diagnostics.length, 1);
  for (const mutate of [
    s => { s.sources[0].diagnostics[0].failed_classes[0].class = 'PII_SENTINEL'; },
    s => { s.sources[0].diagnostics[0].failed_classes[0].count = 0; },
    s => { s.sources[0].diagnostics[0].queue = 'analyze'; },
    s => { s.sources[0].diagnostics[0].raw_reason = 'PII_SENTINEL exploded'; },
    s => { s.sources[0].diagnostics.push({ queue: 'analyze', waiting_children_oldest_ms: 0, last_event_age_ms: 0, failed_classes: [] }); },
    s => { s.sources[0].diagnostics.length = 0; }
  ]) { const raw = v2(); mutate(raw); assert.throws(() => validateSnapshot(reseal(raw), redisConfig), /INVALID_SNAPSHOT/); }
  const unknown = structuredClone(v2());
  Object.assign(unknown.sources[0], { status: 'UNKNOWN', reason: 'COLLECTION_FAILED', accuracy: 'unavailable', metrics: [] });
  assert.throws(() => validateSnapshot(reseal(unknown), redisConfig), /INVALID_SNAPSHOT/);
  capture('snapshot-v2-contract', { rejected_snapshot_mutations: 6, accepted_ok_redis_with_diagnostics: true, rejected_diagnostics_mutations: 6, unknown_with_diagnostics_rejected: true });
});

test('source reference, TLS and operator revision changes invalidate old snapshot provenance', () => {
  const config = configuration(); const raw = snapshot(config);
  for (const update of [
    source => { source.env.host = 'NS_MCP_OTHER_HOST'; },
    source => { source.tls = 'verify'; },
    source => { source.revision++; }
  ]) {
    const changed = structuredClone(config); update(changed.sources[0]);
    assert.throws(() => validateSnapshot(raw, parseConfig(changed)), /INVALID_SNAPSHOT/);
  }
  assert(!JSON.stringify(raw).includes('NS_MCP_'));
  capture('source-provenance', { changed_reference_rejected: true, changed_tls_rejected: true, changed_revision_rejected: true, raw_env_references_not_exported: true });
});

test('whitelisted tools paginate, stale counts become UNKNOWN, old snapshots remain pinned', () => {
  let now = Date.now(); const config = configuration(); const raw = snapshot(config, now);
  const service = createService(config, raw, () => now);
  const page = service.invoke('search', { query: 'sources', limit: 1 });
  assert.equal(page.results.length, 1); assert.equal(page.next_offset, 1);
  assert.equal(service.invoke('fetch', { id: page.results[0].id }).metadata.metrics[0].value, 7);
  for (const [tool, args] of [['search', { query: 'SELECT password FROM users' }], ['search', { query: 'overview', limit: 1000 }], ['overview', { path: '/etc/passwd' }], ['fetch', { id: 'https://internal/?token=x' }], ['fetch', { id: `ns:other:${'a'.repeat(64)}` }], ['shell', {}]]) assert.throws(() => service.invoke(tool, args));
  raw.sources[0].metrics[0].value = 999;
  assert.equal(service.invoke('fetch', { id: page.results[0].id }).metadata.metrics[0].value, 7);
  now += 121000;
  const report = service.invoke('overview', {});
  assert.equal(report.unknown, 2); assert.equal(report.disabled, 1);
  assert.equal(report.sources[0].reason, 'STALE'); assert.deepEqual(report.sources[0].metrics, []);
  assert.equal(service.invoke('fetch', { id: page.results[0].id }).metadata.accuracy, 'unavailable');
  assert.equal(report.duration_ms, 0); assert.equal(report.stale_after_seconds, 120); assert.equal(report.started_at, raw.started_at);
  capture('tools-freshness', { search: page, stale_overview: report, invalid_tool_cases: 6 });
});

test('private snapshot/audit files, symlink refusal, bounded reads, audit redaction and fail closed budget', () => {
  const dir = fixtureDir('files'); const config = configuration(); const snap = snapshot(config);
  publishSnapshot(dir, snap); assert.equal(loadSnapshot(dir, config).hash, snap.hash);
  const newer = snapshot(config, Date.now(), 8); publishSnapshot(dir, newer);
  assert.equal(loadSnapshot(dir, config).hash, newer.hash);
  assert.equal(loadSnapshot(dir, config, snap.hash).hash, snap.hash);
  assert.equal(statSync(join(dir, `${snap.hash}.json`)).mode & 0o777, 0o400);
  const link = join(dir, 'link'); symlinkSync(join(dir, 'current'), link); assert.throws(() => readBounded(link));
  const oversize = join(dir, 'oversize'); writeFileSync(oversize, '123456', { mode: 0o600 }); assert.throws(() => readBounded(oversize, 5));
  const auditPath = join(dir, 'audit.jsonl'); const audit = new Audit(auditPath);
  audit.append(audit.begin({ method: 'tools/call', params: { name: 'search', arguments: { query: 'PII_SENTINEL@example.invalid' } } }), 'TOOL_ERROR'); audit.close();
  const content = readFileSync(auditPath, 'utf8'); assert(!content.includes('PII_SENTINEL')); assert.equal(statSync(auditPath).mode & 0o777, 0o600);
  const full = new Audit(auditPath, 1); assert.throws(() => full.append(full.begin(null), 'OK'), /AUDIT_FULL/); full.close();
  chmodSync(auditPath, 0o644); assert.throws(() => new Audit(auditPath), /AUDIT_POLICY/);
  capture('file-audit-policy', { artifact_directory: dir, snapshot_hash: snap.hash, retained_snapshot_recovered_after_publication: true, audit_redacted: true, failed_closed_on_full_audit: true });
});

test('rate and concurrency budgets recover only on release or next window', () => {
  let now = 0; const limits = new Limits({ concurrency: 1, requestsPerMinute: 3 }, () => now);
  const release = limits.enter(); assert.throws(() => limits.enter(), /LIMIT_EXCEEDED/);
  release(); release(); assert.equal(limits.active, 0);
  limits.enter()(); assert.throws(() => limits.enter(), /LIMIT_EXCEEDED/);
  now = 60000; limits.enter()();
  capture('limit-policy', { concurrency_rejected: true, rate_rejected: true, reset_after_60s: true });
});

test('rss sources pin https feeds, bind transcript documents to fetched metrics and surface via tools', () => {
  const rssConfig = configuration([source('feeds', 'rss')]);
  const feed = rssConfig.sources[0].feeds[0].url;
  for (const invalid of [
    { ...rssConfig, sources: [{ ...rssConfig.sources[0], feeds: [{ url: 'http://feeds.example.invalid/a.rss' }] }] },
    { ...rssConfig, sources: [{ ...rssConfig.sources[0], feeds: [{ url: 'https://user:pass@feeds.example.invalid/a.rss' }] }] },
    { ...rssConfig, sources: [{ ...rssConfig.sources[0], feeds: [{ url: 'https://feeds.example.invalid:8443/a.rss' }] }] },
    { ...rssConfig, sources: [{ ...rssConfig.sources[0], feeds: [{ url: 'ftp://feeds.example.invalid/a.rss' }] }] },
    { ...rssConfig, sources: [{ ...rssConfig.sources[0], feeds: [] }] },
    { ...rssConfig, sources: [{ ...rssConfig.sources[0], feeds: [{ url: feed }, { url: feed }] }] }
  ]) assert.throws(() => parseConfig(invalid), /INVALID_CONFIG/);
  assert.equal(parseConfig(rssConfig).sources[0].feeds.length, 1);
  const raw = snapshot(rssConfig);
  const good = validateSnapshot(raw, rssConfig);
  assert.equal(good.sources[0].scope, 'public_feed_transcripts');
  assert.equal(good.sources[0].consistency, 'bounded_fetch');
  assert.equal(good.sources[0].documents.length, 1);
  for (const mutate of [
    s => { delete s.sources[0].documents; },
    s => { s.sources[0].documents.pop(); },
    s => { s.sources[0].documents[0].bytes = 999999999; },
    s => { s.sources[0].documents[0].transcript_url = 'http://feeds.example.invalid/ep1.vtt'; },
    s => { s.sources[0].documents[0].transcript_type = 'text/csv'; },
    s => { s.sources[0].documents[0].raw_excerpt = 'PII_SENTINEL@example.invalid'; },
    s => { s.sources[0].scope = 'configured_bullmq_keys'; },
    s => { s.sources[0].consistency = 'per_command'; },
    s => { s.sources[0].metrics.find(m => m.metric === 'rss.transcripts_fetched').value = 2; },
    s => { s.sources[0].metrics = s.sources[0].metrics.filter(m => m.metric !== 'rss.feeds_ok'); }
  ]) { const mutated = structuredClone(raw); mutate(mutated); assert.throws(() => validateSnapshot(reseal(mutated), rssConfig), /INVALID_SNAPSHOT/); }
  const mixed = configuration();
  const pgRaw = snapshot(mixed);
  pgRaw.sources[0].documents = structuredClone(pgRaw.sources[1].documents ?? []);
  assert.throws(() => validateSnapshot(reseal(pgRaw), mixed), /INVALID_SNAPSHOT/);
  let now = Date.now();
  const service = createService(rssConfig, raw, () => now);
  const search = service.invoke('search', { query: 'rss' });
  assert.equal(search.results.length, 1);
  const document = service.invoke('fetch', { id: search.results[0].id });
  assert.equal(document.title, 'RSS transcript evidence');
  assert.equal(document.metadata.documents.length, 1);
  now += 121000;
  assert.equal(service.invoke('fetch', { id: search.results[0].id }).metadata.documents, undefined);
  capture('rss-document-contract', { rejected_configs: 6, rejected_snapshot_mutations: 10, postgres_documents_rejected: true, stale_withholds_documents: true });
});

test('podcastindex discovery sources pin credentials, validate count-only snapshots and surface via tools', () => {
  const piConfig = configuration([source('discovery', 'podcastindex')]);
  assert.equal(parseConfig(piConfig).sources[0].maxResults, 20);
  for (const invalid of [
    { ...piConfig, sources: [{ ...piConfig.sources[0], maxResults: 0 }] },
    { ...piConfig, sources: [{ ...piConfig.sources[0], maxResults: 101 }] },
    { ...piConfig, sources: [{ ...piConfig.sources[0], env: { apiKey: 'inline-key-value', apiSecret: 'NS_MCP_PI_SECRET' } }] },
    { ...piConfig, sources: [{ ...piConfig.sources[0], env: { apiKey: 'NS_MCP_PI_API_KEY' } }] }
  ]) assert.throws(() => parseConfig(invalid), /INVALID_CONFIG/);
  const env = fixtureEnvironment(piConfig);
  assert.deepEqual(Object.keys(credentials(piConfig.sources[0], env)).sort(), ['apiKey', 'apiSecret']);
  const badEnv = { ...env };
  delete badEnv[piConfig.sources[0].env.apiSecret];
  assert.throws(() => credentials(piConfig.sources[0], badEnv), /MISSING_CREDENTIAL/);
  const raw = snapshot(piConfig);
  validateSnapshot(raw, piConfig);
  for (const mutate of [
    s => { s.sources[0].metrics = s.sources[0].metrics.filter(m => m.metric !== 'pi.feeds_found'); },
    s => { s.sources[0].documents = []; },
    s => { s.sources[0].scope = 'public_feed_transcripts'; },
    s => { s.sources[0].consistency = 'bounded_fetch'; }
  ]) { const mutated = structuredClone(raw); mutate(mutated); assert.throws(() => validateSnapshot(reseal(mutated), piConfig), /INVALID_SNAPSHOT/); }
  let now = Date.now();
  const service = createService(piConfig, raw, () => now);
  const search = service.invoke('search', { query: 'podcastindex' });
  assert.equal(search.results.length, 1);
  assert.equal(service.invoke('fetch', { id: search.results[0].id }).title, 'Podcast Index discovery counts');
  now += 121000;
  assert.equal(service.invoke('search', { query: 'podcastindex' }).results.length, 1);
  capture('podcastindex-discovery-contract', { rejected_configs: 4, rejected_snapshot_mutations: 4, credentials_bound: true, tools_surface: true });
});
