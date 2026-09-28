import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import net from 'node:net';
import { collect, postgresCounts, redisCounts, rssCollect, podcastIndexCollect, PG_COUNTS, PG_PRIVILEGES } from '../src/collect.mjs';
import { expectedMetrics, credentials, PolicyError } from '../src/policy.mjs';
import { Audit } from '../src/audit.mjs';
import { configuration, source, fixtureEnvironment, fixtureDir, capture } from './helpers.mjs';

test('collector keeps disabled, missing credential, access denied, unreachable and failed distinct', async () => {
  const config = configuration([source('disabled', 'postgres', false), source('missing'), source('offline'), source('denied'), source('broken')]);
  const env = fixtureEnvironment(config); delete env[config.sources[1].env.password];
  const called = []; const dir = fixtureDir('collection-status'); const audit = new Audit(join(dir, 'audit.jsonl'));
  const snap = await collect(config, dir, { env, audit, collectors: { postgres: async s => {
    called.push(s.id);
    if (s.id === 'offline') throw Object.assign(new Error('RAW_SECRET_PII_SENTINEL'), { code: 'ECONNREFUSED' });
    if (s.id === 'denied') throw new PolicyError('ACCESS_DENIED');
    throw new Error('RAW_SECRET_PII_SENTINEL');
  } } });
  audit.close();
  assert.deepEqual(called, ['offline', 'denied', 'broken']);
  assert.deepEqual(snap.sources.map(s => s.reason), ['DISABLED', 'MISSING_CREDENTIAL', 'UNREACHABLE', 'ACCESS_DENIED', 'COLLECTION_FAILED']);
  assert(snap.sources.every(s => s.metrics.length === 0));
  assert(!JSON.stringify(snap).includes('RAW_SECRET')); assert(!readFileSync(join(dir, 'audit.jsonl'), 'utf8').includes('RAW_SECRET'));
  capture('collection-status', { snapshot: snap, artifact_directory: dir, production: false });
});

test('collector singleflight, durable refresh cache and cross-process lock bound source work', async () => {
  const config = configuration([source('alpha')]); const dir = fixtureDir('collection-cache'); const audit = new Audit(join(dir, 'audit.jsonl'));
  let calls = 0, unblock;
  const barrier = new Promise(resolve => { unblock = resolve; });
  const options = { env: fixtureEnvironment(config), audit, collectors: { postgres: async s => { calls++; await barrier; return { metrics: expectedMetrics(s).map(metric => ({ metric, value: 5 })), diagnostics: [] }; } } };
  const first = collect(config, dir, options); const second = collect(config, dir, options);
  assert.equal(first, second); unblock();
  const [a, b] = await Promise.all([first, second]); assert.equal(a.hash, b.hash);
  const cached = await collect(config, dir, options); assert.equal(cached.hash, a.hash); assert.equal(calls, 1);
  const changed = configuration([source('other')]); await assert.rejects(collect(changed, dir, { ...options, env: fixtureEnvironment(changed) }), /REFRESH_THROTTLED/);
  audit.close();
  capture('collection-cache', { collector_invocations: calls, concurrent_same_promise: true, cached_snapshot: a.hash, artifact_directory: dir });
});

test('Postgres wire adapter uses one client, read-only transaction, effective privilege checks, fixed view and timeouts', async () => {
  const s = source('pg'); const config = configuration([s]); const c = credentials(s, fixtureEnvironment(config));
  const commands = []; let connectionOptions, ended = 0, connected = 0;
  class Client {
    constructor(options) { connectionOptions = options; }
    on() {}
    async connect() { connected++; }
    async query(sql) {
      commands.push(sql);
      if (sql === PG_PRIVILEGES) return { rows: [{ permitted: true }] };
      if (sql === PG_COUNTS) return { rows: [Object.fromEntries(expectedMetrics(s).map(m => [m, '17']))] };
      return { rows: [] };
    }
    async end() { ended++; }
  }
  const { metrics } = await postgresCounts(s, c, Client);
  assert.equal(connected, 1); assert.equal(ended, 1); assert(metrics.every(m => m.value === 17));
  assert.deepEqual(commands, ['BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY', PG_PRIVILEGES, PG_COUNTS, 'COMMIT']);
  assert.equal(connectionOptions.options, '-c default_transaction_read_only=on');
  assert.equal(connectionOptions.connectionTimeoutMillis, 2000); assert.equal(connectionOptions.statement_timeout, 2000); assert.equal(connectionOptions.lock_timeout, 250);
  commands.length = 0;
  class Denied extends Client { async query(sql) { if (sql === PG_PRIVILEGES) return { rows: [{ permitted: false }] }; return super.query(sql); } }
  await assert.rejects(postgresCounts(s, c, Denied), /ACCESS_DENIED/); assert(!commands.includes(PG_COUNTS));
  capture('postgres-adapter', { fixed_commands: [PG_PRIVILEGES, PG_COUNTS], one_connection: true, cleanup_observed: ended, privilege_denial_prevents_counts: true, fixture_only: true });
});

test('Redis admission defaults to blocked without granting introspection privileges or making a connection', async () => {
  const s = source('redis', 'redis'); const config = configuration([s]); const c = credentials(s, fixtureEnvironment(config));
  let connections = 0;
  class Redis {
    constructor() { connections++; }
  }
  await assert.rejects(redisCounts(s, c, Redis), /ADMISSION_UNVERIFIED/);
  assert.equal(connections, 0);
  const dir = fixtureDir('redis-admission'); const audit = new Audit(join(dir, 'audit.jsonl'));
  const result = await collect(config, dir, { env: fixtureEnvironment(config), audit }); audit.close();
  assert.equal(result.sources[0].status, 'UNKNOWN'); assert.equal(result.sources[0].reason, 'ADMISSION_UNVERIFIED');
  assert.deepEqual(result.sources[0].metrics, []);
  capture('redis-admission', { connections, snapshot: result, no_admin_acl_privilege: true, artifact_directory: dir });
});

test('real pg client connection refusal produces UNKNOWN without exposing raw connection errors', async () => {
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const config = configuration([source('refused')]); const env = fixtureEnvironment(config); env[config.sources[0].env.port] = String(port);
  const dir = fixtureDir('pg-refusal'); const audit = new Audit(join(dir, 'audit.jsonl'));
  const snap = await collect(config, dir, { env, audit }); audit.close();
  assert.equal(snap.sources[0].status, 'UNKNOWN'); assert.equal(snap.sources[0].reason, 'UNREACHABLE'); assert.deepEqual(snap.sources[0].metrics, []);
  capture('pg-connection-refusal', { snapshot: snap, artifact_directory: dir, production: false });
});

const rssResponse = (status, body) => ({ ok: status < 400, status, headers: new Map(), body: { getReader: () => {
  const chunk = Buffer.from(body); let done = false;
  return { read: async () => (done ? { done: true } : (done = true, { done: false, value: chunk })), cancel: async () => {} };
} } });
const FEED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:podcast="https://podcastindex.org/namespace/1.0" version="2.0"><channel><title>Fixture channel</title>
<item><title>Episode one &amp; two</title><podcast:transcript url="https://cdn.example.invalid/ep1.vtt" type="text/vtt"/></item>
<item><title><![CDATA[Episode two]]></title><podcast:transcript url="https://cdn.example.invalid/ep2.srt" type="text/srt"/><podcast:transcript url="https://cdn.example.invalid/ep2.vtt" type="text/vtt"/></item>
<item><title>Episode three</title></item>
</channel></rss>`;

test('rss collector fetches bounded feeds, prefers VTT transcripts and binds document evidence', async () => {
  const s = source('feeds', 'rss'); const config = configuration([s]);
  const calls = [];
  const fetchImpl = async url => {
    calls.push(String(url));
    if (String(url).endsWith('.rss')) return rssResponse(200, FEED_XML);
    if (String(url) === 'https://cdn.example.invalid/ep1.vtt') return rssResponse(200, 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nhello\n');
    if (String(url) === 'https://cdn.example.invalid/ep2.vtt') return rssResponse(200, 'WEBVTT\nep2\n');
    throw new Error('unexpected fetch ' + url);
  };
  const { metrics, documents } = await rssCollect(s, {}, undefined, { fetchImpl });
  assert.deepEqual(Object.fromEntries(metrics.map(m => [m.metric, m.value])), { 'rss.feeds': 1, 'rss.feeds_ok': 1, 'rss.episodes': 3, 'rss.episodes_with_transcript': 2, 'rss.transcripts_fetched': 2 });
  assert.equal(documents.length, 2);
  assert.equal(documents[0].episode_title, 'Episode one & two');
  assert.equal(documents[0].transcript_url, 'https://cdn.example.invalid/ep1.vtt');
  assert.equal(documents[1].transcript_url, 'https://cdn.example.invalid/ep2.vtt');
  assert(documents.every(d => /^[0-9a-f]{64}$/.test(d.sha256) && d.bytes > 0 && d.transcript_type === 'text/vtt'));
  assert(!calls.some(url => url.endsWith('.srt')));
  capture('rss-collector-parse', { metrics, documents, feeds_fetched: calls.filter(url => url.endsWith('.rss')).length, vtt_preferred_over_srt: true });
});

test('rss collector enforces size bounds, tolerates partial feed failure and fails closed when all feeds fail', async () => {
  const s = { ...source('feeds', 'rss'), feeds: [{ url: 'https://feeds.example.invalid/ok.rss' }, { url: 'https://feeds.example.invalid/dead.rss' }] };
  const oversize = 'x'.repeat(524289);
  const fetchImpl = async url => {
    if (String(url).endsWith('ok.rss')) return rssResponse(200, FEED_XML);
    if (String(url).endsWith('ep1.vtt')) return rssResponse(200, oversize);
    throw Object.assign(new Error('PII_SENTINEL refused'), { code: 'ECONNREFUSED' });
  };
  const { metrics, documents } = await rssCollect(s, {}, undefined, { fetchImpl });
  assert.deepEqual(Object.fromEntries(metrics.map(m => [m.metric, m.value])), { 'rss.feeds': 2, 'rss.feeds_ok': 1, 'rss.episodes': 3, 'rss.episodes_with_transcript': 2, 'rss.transcripts_fetched': 0 });
  assert.deepEqual(documents, []);
  const down = { ...s, feeds: [{ url: 'https://feeds.example.invalid/dead.rss' }] };
  await assert.rejects(rssCollect(down, {}, undefined, { fetchImpl }), /COLLECTION_FAILED/);
  capture('rss-collector-bounds', { oversize_skipped: true, partial_feed_failure_tolerated: true, all_feeds_failed_rejected: true });
});

test('rss source collects documents into the sealed snapshot and audit records the collector method', async () => {
  const config = configuration([source('feeds', 'rss')]); const dir = fixtureDir('rss-collect'); const audit = new Audit(join(dir, 'audit.jsonl'));
  const values = { 'rss.feeds': 1, 'rss.feeds_ok': 1, 'rss.episodes': 2, 'rss.episodes_with_transcript': 1, 'rss.transcripts_fetched': 0 };
  const snap = await collect(config, dir, { env: fixtureEnvironment(config), audit, collectors: { rss: async () => ({ metrics: expectedMetrics(config.sources[0]).map(metric => ({ metric, value: values[metric] })), documents: [] }) } });
  audit.close();
  const collected = snap.sources[0];
  assert.equal(collected.status, 'OK');
  assert.equal(collected.scope, 'public_feed_transcripts');
  assert.equal(collected.consistency, 'bounded_fetch');
  assert.deepEqual(collected.documents, []);
  const rows = readFileSync(join(dir, 'audit.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert(rows.some(row => row.tool === 'collector/rss' && row.status === 'OK'));
  const failDir = fixtureDir('rss-fail'); const failAudit = new Audit(join(failDir, 'audit.jsonl'));
  const failed = await collect(config, failDir, { env: fixtureEnvironment(config), audit: failAudit, collectors: { rss: async () => { throw new Error('PII_SENTINEL network exploded'); } } });
  failAudit.close();
  assert.equal(failed.sources[0].status, 'UNKNOWN');
  assert.equal(failed.sources[0].reason, 'COLLECTION_FAILED');
  assert(!JSON.stringify(failed).includes('PII_SENTINEL'));
  capture('rss-collect-wiring', { snapshot: collected, audit_collector_method: true, failure_redacted: true, artifact_directory: dir });
});

test('podcastindex collector authenticates, parses bounded discovery payloads and maps failures', async () => {
  const s = source('discovery', 'podcastindex');
  const creds = credentials(s, fixtureEnvironment(configuration([s])));
  const calls = [];
  const jsonResponse = (obj, status = 200) => ({ ok: status < 400, status, headers: new Map(), body: { getReader: () => {
    const chunk = new TextEncoder().encode(JSON.stringify(obj));
    let sent = false;
    return { read: async () => { if (sent) return { done: true }; sent = true; return { done: false, value: chunk }; }, cancel: async () => {} };
  } } });
  const fetchImpl = async (url, opts) => { calls.push({ url: String(url), headers: opts.headers }); return jsonResponse({ status: 'true', feeds: [{ itunesId: '1429794306' }, { itunesId: null }, {}] }); };
  const { metrics } = await podcastIndexCollect(s, creds, undefined, { fetchImpl });
  assert.deepEqual(Object.fromEntries(metrics.map(m => [m.metric, m.value])), { 'pi.feeds_found': 3, 'pi.feeds_with_itunes_id': 1 });
  const call = calls[0];
  assert(call.url.startsWith('https://api.podcastindex.org/api/1.0/podcasts/bytag?tag=transcript&max=20'));
  assert.equal(call.headers['X-Auth-Key'], 'fixture-key-12345678');
  assert.equal(call.headers.Authorization, createHash('sha1').update(creds.apiKey + creds.apiSecret + call.headers['X-Auth-Date']).digest('hex'));
  assert(/^[0-9]+$/.test(call.headers['X-Auth-Date']));
  await assert.rejects(podcastIndexCollect(s, creds, undefined, { fetchImpl: async () => jsonResponse({}, 401) }), /ACCESS_DENIED/);
  await assert.rejects(podcastIndexCollect(s, creds, undefined, { fetchImpl: async () => jsonResponse({ status: 'false', feeds: [] }) }), /COLLECTION_FAILED/);
  await assert.rejects(podcastIndexCollect(s, creds, undefined, { fetchImpl: async () => jsonResponse({ unexpected: true }) }), /COLLECTION_FAILED/);
  const config = configuration([s]);
  const dir = fixtureDir('pi-collect');
  const audit = new Audit(join(dir, 'audit.jsonl'));
  const snap = await collect(config, dir, { env: fixtureEnvironment(config), audit, collectors: { podcastindex: (src, c) => podcastIndexCollect(src, c, undefined, { fetchImpl }) } });
  audit.close();
  assert.equal(snap.sources[0].status, 'OK');
  assert.equal(snap.sources[0].scope, 'podcast_index_discovery');
  assert.equal(snap.sources[0].consistency, 'authenticated_api');
  const rows = readFileSync(join(dir, 'audit.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert(rows.some(row => row.tool === 'collector/podcastindex' && row.status === 'OK'));
  capture('podcastindex-collect', { auth_bound: true, counts_only: true, failure_mapped: true });
});
