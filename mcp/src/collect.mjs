import { createHash } from 'node:crypto';
import pg from 'pg';
import Redis from 'ioredis';
import { openSync, closeSync, unlinkSync, constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { credentials, expectedMetrics, inventory, inventoryHash, seal, validateSnapshot, STATES, PolicyError, digest, SOURCE_SCOPE, SOURCE_CONSISTENCY, TRANSCRIPT_TYPES } from './policy.mjs';
import { verifyRedisAttestation } from './attest.mjs';
import { atomicPrivateFile, privateDirectory, readBounded, loadSnapshot, publishSnapshot } from './files.mjs';

// Check effective privileges, including grants inherited through PUBLIC. Never query base data.
export const PG_PRIVILEGES = `SELECT
  current_user = 'nanosparks_mcp_reader'
  AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND
    (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls))
  AND NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE member = (SELECT oid FROM pg_roles WHERE rolname = current_user))
  AND NOT has_database_privilege(current_database(), 'CREATE,TEMP')
  AND NOT EXISTS (SELECT 1 FROM pg_namespace WHERE has_schema_privilege(oid, 'CREATE'))
  AND NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.prosecdef AND has_function_privilege(p.oid, 'EXECUTE'))
  AND NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f') AND (
        (NOT (n.nspname = 'nanosparks_mcp' AND c.relname = 'business_counts') AND
          (has_table_privilege(c.oid, 'SELECT') OR has_any_column_privilege(c.oid, 'SELECT')))
        OR has_table_privilege(c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR has_any_column_privilege(c.oid, 'INSERT,UPDATE,REFERENCES')))
  AND NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND CASE WHEN c.relkind = 'S' THEN has_sequence_privilege(c.oid, 'USAGE,SELECT,UPDATE') ELSE false END)
  AND has_table_privilege('nanosparks_mcp.business_counts', 'SELECT') AS permitted`;
export const PG_COUNTS = `SELECT conversations_total, conversations_completed, conversations_failed,
  extractions_total, extractions_completed, extractions_failed,
  extractions_pending, extractions_running
  FROM nanosparks_mcp.business_counts LIMIT 1`;
function count(value) {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d{1,16}$/.test(value))) throw new PolicyError('COLLECTION_FAILED');
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new PolicyError('COLLECTION_FAILED');
  return n;
}
const FAILURE_MATCHERS = [
  ['stalled', /stalled|stall/i],
  ['timeout', /timeout|timed out|etimedout|deadline/i],
  ['connection', /econn|eai_again|connection|socket|network|fetch failed|reset by peer/i],
  ['rate_limit', /rate.?limit|429|quota|too many/i],
  ['auth', /401|403|unauthorized|forbidden|api key|invalid[_ ]?key|auth/i],
  ['missing_dependency', /missing|not found|enoent/i],
  ['oom', /heap|out of memory|oom|killed/i],
  ['assertion', /assert|invariant|expected/i]
];
export function classifyFailure(text) {
  const value = String(text ?? '');
  for (const [failureClass, pattern] of FAILURE_MATCHERS) if (pattern.test(value)) return failureClass;
  return 'unknown';
}
export async function postgresCounts(source, c, Client = pg.Client) {
  const client = new Client({ host: c.host, port: c.port, user: c.username, password: c.password, database: c.database,
    ssl: source.tls === 'verify' ? { rejectUnauthorized: true } : false,
    connectionTimeoutMillis: 2000, statement_timeout: 2000, lock_timeout: 250,
    query_timeout: 2500, idle_in_transaction_session_timeout: 3000,
    application_name: 'nanosparks_mcp_collector', options: '-c default_transaction_read_only=on',
    keepAlive: false });
  client.on('error', () => {});
  // A wall-clock bound also covers silent peers and a broken connection during cleanup.
  const deadline = setTimeout(() => { void client.end().catch(() => {}); }, 10000);
  try {
    await client.connect();
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const permission = await client.query(PG_PRIVILEGES);
    if (permission.rows.length !== 1 || permission.rows[0].permitted !== true) throw new PolicyError('ACCESS_DENIED');
    const result = await client.query(PG_COUNTS);
    if (result.rows.length !== 1) throw new PolicyError('COLLECTION_FAILED');
    const row = result.rows[0];
    if (Object.keys(row).sort().join(',') !== [...expectedMetrics(source)].sort().join(',')) throw new PolicyError('COLLECTION_FAILED');
    const metrics = expectedMetrics(source).map(metric => ({ metric, value: count(row[metric]) }));
    await client.query('COMMIT');
    return { metrics };
  } finally { clearTimeout(deadline); await client.end(); }
}
export async function redisCounts(source, c, RedisClient = Redis, { attestation, env = process.env, now = Date.now } = {}) {
  // The counts credential cannot see its own effective ACL. Admission requires
  // a fresh, admin-verified, Ed25519-signed receipt bound to this exact source.
  verifyRedisAttestation({ source, attestation, username: c.username, env, now });
  const client = new RedisClient({ host: c.host, port: c.port, username: c.username, password: c.password,
    enableReadyCheck: false, disableClientInfo: true, maxRetriesPerRequest: 0, connectTimeout: 2000,
    commandTimeout: 2000, keepAlive: 0, retryStrategy: () => null, reconnectOnError: () => null,
    ...(source.tls === 'verify' ? { tls: {} } : {}) });
  client.on?.('error', () => {});
  // A wall-clock bound also covers silent peers and a broken connection during cleanup.
  const deadline = setTimeout(() => { try { client.disconnect(); } catch { /* fixed lifetime */ } }, 10000);
  try {
    const at = now();
    const metrics = [];
    const diagnostics = [];
    for (const queue of source.queues) {
      for (const [state, command] of Object.entries(STATES)) {
        const value = await (command === 'llen' ? client.llen(`bull:${queue}:${state}`) : client.zcard(`bull:${queue}:${state}`));
        if (!Number.isSafeInteger(value) || value < 0) throw new PolicyError('COLLECTION_FAILED');
        metrics.push({ metric: `${queue}.${state}`, value });
      }
      for (const windowState of ['completed', 'failed']) {
        const value = await client.zcount(`bull:${queue}:${windowState}`, '(' + (at - 86400000), '+inf');
        if (!Number.isSafeInteger(value) || value < 0) throw new PolicyError('COLLECTION_FAILED');
        metrics.push({ metric: `${queue}.${windowState}_24h`, value });
      }
      const oldest = await client.zrange(`bull:${queue}:waiting-children`, '0', '0', 'WITHSCORES');
      let waitingChildren = null;
      if (Array.isArray(oldest) && oldest.length >= 2) {
        const score = Number(oldest[1]);
        if (!Number.isFinite(score) || score <= 0) throw new PolicyError('COLLECTION_FAILED');
        waitingChildren = Math.max(0, at - score);
      }
      const events = await client.xrange(`bull:${queue}:events`, '-', '+', 'COUNT', 200);
      let newest = null;
      const reasons = [];
      if (Array.isArray(events)) for (const entry of events) {
        const ms = Number(String(entry[0]).split('-')[0]);
        if (!Number.isFinite(ms) || ms <= 0) throw new PolicyError('COLLECTION_FAILED');
        if (newest === null || ms > newest) newest = ms;
        const fields = entry[1];
        for (let i = 0; i + 1 < fields.length; i += 2) if (fields[i] === 'failedReason') reasons.push(String(fields[i + 1]));
      }
      const counts = new Map();
      for (const text of reasons) { const cls = classifyFailure(text); counts.set(cls, (counts.get(cls) ?? 0) + 1); }
      const failed_classes = [...counts].map(([cls, n]) => ({ class: cls, count: n }))
        .sort((a, b) => b.count - a.count || (a.class < b.class ? -1 : 1)).slice(0, 4);
      diagnostics.push({ queue, waiting_children_oldest_ms: waitingChildren, last_event_age_ms: newest === null ? null : Math.max(0, at - newest), failed_classes });
    }
    return { metrics, diagnostics };
  } finally { clearTimeout(deadline); try { client.disconnect(); } catch { /* fixed lifetime */ } }
}
const RSS_LIMITS = { feedBytes: 8388608, transcriptBytes: 524288, redirects: 3, timeoutMs: 10000, totalMs: 20000, transcriptsPerFeed: 1, maxEpisodes: 24, maxDocuments: 8 };
const TRANSCRIPT_ORDER = Object.fromEntries(TRANSCRIPT_TYPES.map((type, index) => [type, index]));
async function boundedFetch(url, fetchImpl, deadline, limit, redirects = RSS_LIMITS.redirects, headers, statusToReason) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new PolicyError('COLLECTION_FAILED');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(remaining, RSS_LIMITS.timeoutMs));
  try {
    const response = await fetchImpl(url, { redirect: 'manual', signal: controller.signal, ...(headers ? { headers } : {}) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers?.get?.('location');
      try { await response.body?.cancel(); } catch { /* already closed */ }
      if (redirects <= 0 || !location) throw new PolicyError('COLLECTION_FAILED');
      const next = new URL(location, url);
      if (next.protocol !== 'https:' || next.username || next.password || next.port) throw new PolicyError('COLLECTION_FAILED');
      return await boundedFetch(next, fetchImpl, deadline, limit, redirects - 1, headers, statusToReason);
    }
    if (!response.ok) {
      const mapped = statusToReason ? statusToReason(response.status) : undefined;
      if (mapped) throw new PolicyError(mapped);
      throw new PolicyError('COLLECTION_FAILED');
    }
    const reader = response.body.getReader();
    const chunks = []; let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > limit) throw new PolicyError('COLLECTION_FAILED');
        chunks.push(value);
      }
    } finally { try { await reader.cancel(); } catch { /* already closed */ } }
    return Buffer.concat(chunks);
  } finally { clearTimeout(timer); }
}
function decodeEntities(value) {
  return String(value).replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/&(amp|lt|gt|quot|apos|#x27|#39);/gi, (match, entity) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#x27': "'", '#39': "'" }[entity.toLowerCase()] ?? match))
    .replace(/\s+/g, ' ').trim().slice(0, 200);
}
function parseFeed(xml) {
  const text = Buffer.from(xml).toString('utf8');
  const episodes = [];
  const pattern = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = pattern.exec(text)) && episodes.length < RSS_LIMITS.maxEpisodes) {
    const item = match[1];
    const rawTitle = (/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/.exec(item)?.[1] ?? '').replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '');
    const transcripts = [];
    const transcriptPattern = /<podcast:transcript\b([^>]*?)>/g;
    let transcriptMatch;
    while ((transcriptMatch = transcriptPattern.exec(item))) {
      const attributes = transcriptMatch[1];
      const url = /url="([^"]+)"/.exec(attributes)?.[1];
      const type = /type="([^"]+)"/.exec(attributes)?.[1];
      if (url && type) transcripts.push({ url: decodeEntities(url), type });
    }
    episodes.push({ title: decodeEntities(rawTitle) || '(untitled)', transcripts });
  }
  return episodes;
}
const PI_LIMITS = { maxBytes: 2097152, timeoutMs: 10000, totalMs: 15000 };
export async function podcastIndexCollect(source, credentials, _unused, { fetchImpl = fetch, now = Date.now } = {}) {
  const start = now();
  const authDate = Math.floor(start / 1000).toString();
  const headers = { 'User-Agent': 'NanoSparksMCP/1.0 (read-only discovery)', 'X-Auth-Key': credentials.apiKey, 'X-Auth-Date': authDate, Authorization: createHash('sha1').update(credentials.apiKey + credentials.apiSecret + authDate).digest('hex') };
  const url = new URL('https://api.podcastindex.org/api/1.0/podcasts/bytag');
  url.searchParams.set('tag', 'transcript');
  url.searchParams.set('max', String(source.maxResults));
  const bytes = await boundedFetch(url, fetchImpl, start + PI_LIMITS.totalMs, PI_LIMITS.maxBytes, 2, headers, status => [401, 403].includes(status) ? 'ACCESS_DENIED' : undefined);
  let payload;
  try { payload = JSON.parse(bytes.toString('utf8')); } catch { throw new PolicyError('COLLECTION_FAILED'); }
  if (!payload || !(payload.status === true || payload.status === 'true') || !Array.isArray(payload.feeds)) throw new PolicyError('COLLECTION_FAILED');
  const feeds = payload.feeds.filter(feed => feed && typeof feed === 'object');
  return { metrics: [
    { metric: 'pi.feeds_found', value: feeds.length },
    { metric: 'pi.feeds_with_itunes_id', value: feeds.filter(feed => typeof feed.itunesId === 'string' && /^\d+$/.test(feed.itunesId)).length }
  ] };
}
export async function rssCollect(source, _credentials, _unused, { fetchImpl = fetch, now = Date.now } = {}) {
  const start = now();
  const deadline = start + RSS_LIMITS.totalMs;
  const totals = { 'rss.feeds': source.feeds.length, 'rss.feeds_ok': 0, 'rss.episodes': 0, 'rss.episodes_with_transcript': 0, 'rss.transcripts_fetched': 0 };
  const documents = [];
  for (const feed of source.feeds) {
    let episodes;
    try { episodes = parseFeed(await boundedFetch(feed.url, fetchImpl, deadline, RSS_LIMITS.feedBytes)); }
    catch { continue; }
    totals['rss.feeds_ok']++;
    totals['rss.episodes'] += episodes.length;
    const candidates = episodes.flatMap(episode => (episode.transcripts.filter(t => t.type in TRANSCRIPT_ORDER).sort((a, b) => TRANSCRIPT_ORDER[a.type] - TRANSCRIPT_ORDER[b.type]).slice(0, RSS_LIMITS.transcriptsPerFeed).map(transcript => ({ ...transcript, title: episode.title }))));
    totals['rss.episodes_with_transcript'] += candidates.length;
    for (const candidate of candidates) {
      if (documents.length >= RSS_LIMITS.maxDocuments || now() >= deadline) break;
      let url;
      try { url = new URL(candidate.url, feed.url); } catch { continue; }
      if (url.protocol !== 'https:' || url.username || url.password || url.port) continue;
      try {
        const bytes = await boundedFetch(url, fetchImpl, deadline, RSS_LIMITS.transcriptBytes);
        documents.push({ feed_url: feed.url, episode_title: candidate.title, transcript_url: url.toString(), transcript_type: candidate.type, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), fetched_at: new Date(now()).toISOString() });
        totals['rss.transcripts_fetched']++;
      } catch { continue; }
    }
  }
  if (!totals['rss.feeds_ok']) throw new PolicyError('COLLECTION_FAILED');
  return { metrics: Object.entries(totals).map(([metric, value]) => ({ metric, value })), documents };
}
function reason(error) {
  if (error instanceof PolicyError && ['MISSING_CREDENTIAL', 'INVALID_CREDENTIAL_CONFIG', 'ACCESS_DENIED', 'ADMISSION_UNVERIFIED'].includes(error.code)) return error.code;
  if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH'].includes(error.code)) return 'UNREACHABLE';
  if (['28P01', '28000', '42501'].includes(error.code)) return 'ACCESS_DENIED';
  return 'COLLECTION_FAILED';
}
const flights = new Map();
export function collect(config, dir, { env = process.env, attestation, collectors = { postgres: postgresCounts, redis: redisCounts, rss: rssCollect, podcastindex: podcastIndexCollect }, now = Date.now, audit } = {}) {
  if (!audit) return Promise.reject(new PolicyError('AUDIT_REQUIRED'));
  const key = resolve(dir);
  const existing = flights.get(key);
  if (existing) return existing.configHash === digest(config) ? existing.promise : Promise.reject(new PolicyError('COLLECTION_BUSY'));
  const promise = perform();
  flights.set(key, { configHash: digest(config), promise });
  promise.finally(() => flights.delete(key)).catch(() => {});
  return promise;
  async function perform() {
    const startMs = now();
    privateDirectory(dir);
    const lock = join(dir, 'collect.lock');
    let fd;
    try { fd = openSync(lock, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
    catch { throw new PolicyError('COLLECTION_BUSY'); }
    try {
      const attempt = join(dir, 'last-attempt.json');
      let last;
      try { last = JSON.parse(readBounded(attempt, 512, true)); } catch (e) { if (e.code !== 'ENOENT') throw new PolicyError('INVALID_CACHE'); }
      if (last && (!Number.isSafeInteger(last.at) || last.at > now() + 5000)) throw new PolicyError('INVALID_CACHE');
      if (last && now() - last.at < config.refreshSeconds * 1000) {
        if (last.config !== digest(config)) throw new PolicyError('REFRESH_THROTTLED');
        audit.append(audit.begin({ method: 'collector/cache' }), 'OK');
        return loadSnapshot(dir, config);
      }
      atomicPrivateFile(attempt, JSON.stringify({ at: now(), config: digest(config) }));
      const sources = [];
      for (const source of config.sources) {
        const context = audit.begin({ method: `collector/${source.kind}`, params: { source: source.id } });
        audit.append(context, 'STARTED');
        let status = 'DISABLED', failure = 'DISABLED', metrics = [], diagnostics, documents;
        if (source.enabled) {
          try {
            const result = await collectors[source.kind](source, credentials(source, env), undefined, { attestation, env, now });
            if (!result || !Array.isArray(result.metrics)) throw new PolicyError('COLLECTION_FAILED');
            metrics = result.metrics;
            if (source.kind === 'redis' && Array.isArray(result.diagnostics)) diagnostics = result.diagnostics;
            if (source.kind === 'rss' && Array.isArray(result.documents)) documents = result.documents;
            status = 'OK'; failure = 'NONE';
          }
          catch (error) { status = 'UNKNOWN'; failure = reason(error); metrics = []; diagnostics = undefined; documents = undefined; }
        }
        audit.append(context, failure === 'NONE' ? 'OK' : failure);
        sources.push(seal({ id: source.id, kind: source.kind, enabled: source.enabled,
          source_revision: source.revision, provenance_hash: digest(inventory(config).find(s => s.id === source.id)),
          generated_at: new Date(now()).toISOString(), scope: SOURCE_SCOPE[source.kind],
          status, reason: failure, accuracy: status === 'OK' ? 'exact' : 'unavailable',
          consistency: SOURCE_CONSISTENCY[source.kind], metrics, ...(diagnostics ? { diagnostics } : {}), ...(documents ? { documents } : {}) }));
      }
      const endMs = now();
      const snapshot = validateSnapshot(seal({ version: 2, started_at: new Date(startMs).toISOString(), generated_at: new Date(endMs).toISOString(), duration_ms: Math.max(0, endMs - startMs), refresh_seconds: config.refreshSeconds, stale_after_seconds: config.staleSeconds, inventory_hash: inventoryHash(config), sources }), config, now());
      publishSnapshot(dir, snapshot);
      return snapshot;
    } finally { closeSync(fd); unlinkSync(lock); }
  }
}
