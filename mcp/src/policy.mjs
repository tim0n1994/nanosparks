import { createHash } from 'node:crypto';
import { z } from 'zod';

export const MAX_SOURCES = 16;
export const MAX_FILE = 131072;
export const MAX_BODY = 8192;
export const MAX_OUTPUT = 65536;
export const QUEUES = ['ingest', 'transcribe', 'analyze', 'diarize', 'normalize_turns', 'retention', 'project', 'person_profile'];
export const STATES = { wait: 'llen', active: 'llen', paused: 'llen', delayed: 'zcard', failed: 'zcard', completed: 'zcard', prioritized: 'zcard', 'waiting-children': 'zcard' };
export const PG_METRICS = ['conversations_total', 'conversations_completed', 'conversations_failed', 'extractions_total', 'extractions_completed', 'extractions_failed', 'extractions_pending', 'extractions_running'];
export const WINDOW_STATES = ['completed', 'failed'];
export const RSS_METRICS = ['rss.feeds', 'rss.feeds_ok', 'rss.episodes', 'rss.episodes_with_transcript', 'rss.transcripts_fetched'];
export const PI_METRICS = ['pi.feeds_found', 'pi.feeds_with_itunes_id'];
export const METRICS = [...PG_METRICS, ...QUEUES.flatMap(queue => [...Object.keys(STATES).map(state => `${queue}.${state}`), ...WINDOW_STATES.map(state => `${queue}.${state}_24h`)]), ...RSS_METRICS, ...PI_METRICS];
export const FAILURE_CLASSES = ['timeout', 'stalled', 'connection', 'rate_limit', 'auth', 'missing_dependency', 'oom', 'assertion', 'unknown'];
export const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export class PolicyError extends Error {
  constructor(code = 'POLICY_REJECTED') { super(code); this.code = code; }
}
export const idSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/);
const envRef = z.string().regex(/^NS_MCP_[A-Z0-9_]{1,80}$/);
const connection = z.object({ host: envRef, port: envRef, username: envRef, password: envRef }).strict();
const base = { id: idSchema, revision: z.number().int().min(1).max(2147483647), enabled: z.boolean() };
const pgSource = z.object({ ...base, kind: z.literal('postgres'), env: connection.extend({ database: envRef }).strict(), tls: z.enum(['verify', 'loopback']) }).strict();
const redisSource = z.object({ ...base, kind: z.literal('redis'), env: connection, tls: z.enum(['verify', 'loopback']), queues: z.array(z.enum(QUEUES)).min(1).max(8).refine(a => new Set(a).size === a.length) }).strict();
const feedUrl = z.string().max(512).refine(value => {
  try { const u = new URL(value); return u.protocol === 'https:' && u.origin === `https://${u.hostname}` && !u.username && !u.password; } catch { return false; }
});
const rssSource = z.object({ ...base, kind: z.literal('rss'), feeds: z.array(z.object({ url: feedUrl }).strict()).min(1).max(4).refine(feeds => new Set(feeds.map(f => f.url)).size === feeds.length) }).strict();
const podcastindexSource = z.object({ ...base, kind: z.literal('podcastindex'), env: z.object({ apiKey: envRef, apiSecret: envRef }).strict(), maxResults: z.number().int().min(1).max(100).default(20) }).strict();
export const configSchema = z.object({
  version: z.literal(1),
  citationOrigin: z.string().max(256).refine(value => {
    try { const u = new URL(value); return u.protocol === 'https:' && u.origin === value && !u.username && !u.password && !u.port; } catch { return false; }
  }),
  refreshSeconds: z.number().int().min(60).max(86400).default(300),
  staleSeconds: z.number().int().min(60).max(86400).default(900),
  sources: z.array(z.discriminatedUnion('kind', [pgSource, redisSource, rssSource, podcastindexSource])).min(1).max(MAX_SOURCES),
  http: z.object({
    host: z.literal('127.0.0.1'), port: z.number().int().min(1024).max(65535),
    tokenEnv: envRef,
    allowedOrigins: z.array(z.string().max(256).refine(value => {
      try { const u = new URL(value); return u.protocol === 'https:' && u.origin === value && !u.username && !u.password; } catch { return false; }
    })).max(8).default([]),
    requestsPerMinute: z.number().int().min(1).max(600).default(120),
    concurrency: z.number().int().min(1).max(8).default(4)
  }).strict().optional()
}).strict().refine(value => new Set(value.sources.map(s => s.id)).size === value.sources.length)
  .refine(value => value.staleSeconds >= value.refreshSeconds);
export function parseConfig(value) { const r = configSchema.safeParse(value); if (!r.success) throw new PolicyError('INVALID_CONFIG'); return freeze(r.data); }
export const inventory = config => config.sources.map(({ id, revision, kind, enabled, queues, env, tls, feeds, maxResults }) => ({ id, revision, kind, enabled, env, tls, ...(queues ? { queues } : {}), ...(feeds ? { feeds } : {}), ...(maxResults !== undefined ? { maxResults } : {}) }));
export const inventoryHash = config => digest(inventory(config));
export function credentials(source, env = process.env) {
  if (source.kind === 'rss') return {};
  const c = {};
  for (const [field, ref] of Object.entries(source.env)) {
    const value = env[ref];
    if (!value) throw new PolicyError('MISSING_CREDENTIAL');
    if (value.length > 1024 || /[\r\n\0]/.test(value)) throw new PolicyError('INVALID_CREDENTIAL_CONFIG');
    c[field] = value;
  }
  if (source.kind === 'podcastindex') {
    if (!/^[a-zA-Z0-9._:-]{8,256}$/.test(c.apiKey) || !/^[a-zA-Z0-9._:-]{8,256}$/.test(c.apiSecret)) throw new PolicyError('INVALID_CREDENTIAL_CONFIG');
    return { apiKey: c.apiKey, apiSecret: c.apiSecret };
  }
  if (!/^[a-zA-Z0-9._:-]+$/.test(c.host) || !/^\d{1,5}$/.test(c.port) || +c.port < 1 || +c.port > 65535) throw new PolicyError('INVALID_CREDENTIAL_CONFIG');
  if (source.tls === 'loopback' && !['127.0.0.1', '::1'].includes(c.host)) throw new PolicyError('INVALID_CREDENTIAL_CONFIG');
  if (source.kind === 'postgres' && c.username !== 'nanosparks_mcp_reader') throw new PolicyError('INVALID_CREDENTIAL_CONFIG');
  if (source.kind === 'redis' && c.username !== 'nanosparks_mcp_counts') throw new PolicyError('INVALID_CREDENTIAL_CONFIG');
  return { ...c, port: +c.port };
}
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const timestamp = z.iso.datetime();
export const REASONS = ['NONE', 'MISSING_CREDENTIAL', 'INVALID_CREDENTIAL_CONFIG', 'UNREACHABLE', 'ACCESS_DENIED', 'ADMISSION_UNVERIFIED', 'COLLECTION_FAILED', 'DISABLED'];
const failureClass = z.object({ class: z.enum(FAILURE_CLASSES), count: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) }).strict();
const queueDiagnostics = z.object({ queue: z.enum(QUEUES), waiting_children_oldest_ms: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(), last_event_age_ms: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(), failed_classes: z.array(failureClass).max(4) }).strict();
export const SOURCE_SCOPE = { postgres: 'database_aggregate_counts', redis: 'configured_bullmq_keys', rss: 'public_feed_transcripts', podcastindex: 'podcast_index_discovery' };
export const SOURCE_CONSISTENCY = { postgres: 'repeatable_read', redis: 'per_command', rss: 'bounded_fetch', podcastindex: 'authenticated_api' };
export const TRANSCRIPT_TYPES = ['text/vtt', 'text/srt', 'application/subrip', 'text/plain', 'text/html', 'application/json'];
const documentEntry = z.object({
  feed_url: feedUrl,
  episode_title: z.string().min(1).max(200).refine(value => !/[\u0000-\u001F\u007F]/.test(value)),
  transcript_url: feedUrl,
  transcript_type: z.enum(TRANSCRIPT_TYPES),
  bytes: z.number().int().min(1).max(524288),
  sha256: hash,
  fetched_at: timestamp
}).strict();
export const sourceSchema = z.object({
  id: idSchema, kind: z.enum(['postgres', 'redis', 'rss', 'podcastindex']), enabled: z.boolean(),
  source_revision: z.number().int().min(1).max(2147483647), provenance_hash: hash,
  generated_at: timestamp, hash,
  scope: z.enum(['database_aggregate_counts', 'configured_bullmq_keys', 'public_feed_transcripts', 'podcast_index_discovery']),
  status: z.enum(['OK', 'UNKNOWN', 'DISABLED']),
  reason: z.enum(REASONS),
  accuracy: z.enum(['exact', 'unavailable']),
  consistency: z.enum(['repeatable_read', 'per_command', 'bounded_fetch', 'authenticated_api']),
  metrics: z.array(z.object({ metric: z.enum(METRICS), value: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict()).max(96),
  diagnostics: z.array(queueDiagnostics).max(8).optional(),
  documents: z.array(documentEntry).max(8).optional()
}).strict();
export const snapshotSchema = z.object({ version: z.literal(2), started_at: timestamp, generated_at: timestamp, duration_ms: z.number().int().min(0), refresh_seconds: z.number().int().min(60).max(86400), stale_after_seconds: z.number().int().min(60).max(86400), inventory_hash: hash, hash, sources: z.array(sourceSchema).min(1).max(MAX_SOURCES) }).strict();
export function seal(value) { return { ...value, hash: digest(value) }; }
export function expectedMetrics(source) { return source.kind === 'postgres' ? PG_METRICS : source.kind === 'rss' ? RSS_METRICS : source.kind === 'podcastindex' ? PI_METRICS : source.queues.flatMap(q => [...Object.keys(STATES).map(s => `${q}.${s}`), ...WINDOW_STATES.map(s => `${q}.${s}_24h`)]); }
export function validateSnapshot(raw, config, now = Date.now()) {
  const parsed = snapshotSchema.safeParse(raw);
  if (!parsed.success) throw new PolicyError('INVALID_SNAPSHOT');
  const s = parsed.data;
  const { hash: h, ...body } = s;
  if (h !== digest(body) || s.inventory_hash !== inventoryHash(config) || s.sources.length !== config.sources.length || Date.parse(s.generated_at) > now + 5000) throw new PolicyError('INVALID_SNAPSHOT');
  if (s.duration_ms !== Math.max(0, Date.parse(s.generated_at) - Date.parse(s.started_at)) || s.refresh_seconds !== config.refreshSeconds || s.stale_after_seconds !== config.staleSeconds || Date.parse(s.started_at) > Date.parse(s.generated_at)) throw new PolicyError('INVALID_SNAPSHOT');
  s.sources.forEach((source, index) => {
    const configured = config.sources[index];
    const { hash: sh, ...rest } = source;
    const expected = expectedMetrics(configured);
    if (sh !== digest(rest) || source.source_revision !== configured.revision || source.provenance_hash !== digest(inventory(config)[index]) || source.id !== configured.id || source.kind !== configured.kind || source.enabled !== configured.enabled || source.generated_at > s.generated_at || Date.parse(source.generated_at) > now + 5000 || source.scope !== SOURCE_SCOPE[source.kind] || source.consistency !== SOURCE_CONSISTENCY[source.kind]) throw new PolicyError('INVALID_SNAPSHOT');
    if (source.status === 'OK') {
      if (!configured.enabled || source.reason !== 'NONE' || source.accuracy !== 'exact' || canonical(source.metrics.map(m => m.metric).sort()) !== canonical([...expected].sort())) throw new PolicyError('INVALID_SNAPSHOT');
      if (source.kind === 'redis') {
        if (!source.diagnostics || canonical(source.diagnostics.map(d => d.queue).sort()) !== canonical([...configured.queues].sort())) throw new PolicyError('INVALID_SNAPSHOT');
        if (source.documents) throw new PolicyError('INVALID_SNAPSHOT');
      } else if (source.kind === 'rss') {
        const fetched = source.metrics.find(m => m.metric === 'rss.transcripts_fetched');
        if (!source.documents || !fetched || fetched.value !== source.documents.length) throw new PolicyError('INVALID_SNAPSHOT');
      } else if (source.diagnostics || source.documents) throw new PolicyError('INVALID_SNAPSHOT');
    } else if (source.accuracy !== 'unavailable' || source.metrics.length || source.diagnostics || source.documents || (configured.enabled ? source.status !== 'UNKNOWN' || !REASONS.filter(r => !['NONE', 'DISABLED'].includes(r)).includes(source.reason) : source.status !== 'DISABLED' || source.reason !== 'DISABLED')) throw new PolicyError('INVALID_SNAPSHOT');
  });
  return freeze(s);
}
