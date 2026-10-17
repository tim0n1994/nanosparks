import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema, McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { sourceSchema, REASONS, idSchema, MAX_OUTPUT, PolicyError, validateSnapshot } from './policy.mjs';

const sourceOutput = sourceSchema.extend({ reason: z.enum([...REASONS, 'STALE']), freshness: z.enum(['CURRENT', 'STALE']) }).strict();
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const docId = z.string().regex(/^ns:[a-z][a-z0-9_-]{0,31}:[0-9a-f]{64}$/);
const citation = z.string().url().max(400);
const title = z.enum(['PostgreSQL aggregate counts', 'Redis queue counts', 'RSS transcript evidence', 'Podcast Index discovery counts']);
const titles = { postgres: 'PostgreSQL aggregate counts', redis: 'Redis queue counts', rss: 'RSS transcript evidence', podcastindex: 'Podcast Index discovery counts' };
const summary = z.object({ snapshot_hash: hash, generated_at: z.iso.datetime(), started_at: z.iso.datetime(), duration_ms: z.number().int().min(0), refresh_seconds: z.number().int().min(60).max(86400), stale_after_seconds: z.number().int().min(60).max(86400), configured: z.number().int().min(1).max(16), enabled: z.number().int().min(0).max(16), ok: z.number().int().min(0).max(16), unknown: z.number().int().min(0).max(16), disabled: z.number().int().min(0).max(16) }).strict();
const failureCount = z.number().int().min(0).nullable();
const classCountDiagnostics = z.object({ evaluated_at: z.iso.datetime(), reported_class_count_sum: failureCount, reported_unknown_class_count: failureCount, sum_vs_failed: z.enum(['LESS_THAN', 'EQUAL', 'GREATER_THAN', 'UNAVAILABLE']), comparability: z.literal('UNKNOWN'), unclassified_failed: z.null(), class_coverage_ratio: z.null(), missing_evidence: z.array(z.string()) }).strict();
const failureSource = z.object({ source_id: idSchema, kind: z.enum(['postgres', 'redis']), source_hash: hash, generated_at: z.iso.datetime(), scope: z.enum(['database_aggregate_counts', 'configured_bullmq_keys']), status: z.enum(['OK', 'UNKNOWN', 'DISABLED']), reason: z.enum([...REASONS, 'STALE']), freshness: z.enum(['CURRENT', 'STALE']), extraction: z.object({ total: failureCount, completed: failureCount, failed: failureCount }).strict().optional(), queues: z.array(z.object({ queue: z.string(), failed: failureCount, failed_24h: failureCount, failed_classes: z.array(z.object({ class: z.string(), count: z.number().int().min(1) }).strict()).nullable(), class_count_diagnostics: classCountDiagnostics }).strict()).optional(), missing_evidence: z.array(z.string()) }).strict();
const failureSummary = z.object({ schema_version: z.literal(1), derived_from_snapshot_hash: hash, generated_at: z.iso.datetime(), coverage: z.object({ scope: z.literal('all_configured_postgres_redis_sources'), source_count: z.number().int(), included_source_ids: z.array(idSchema) }).strict(), sources: z.array(failureSource), missing_evidence: z.array(z.string()) }).strict();
function classCountEvidence(queue, source, evaluatedAt) {
  const missing_evidence = source.missing_evidence.filter(reason => reason.startsWith(`${queue.queue}.`));
  let sum = null;
  let unknown = null;
  if (source.status === 'OK' && source.freshness === 'CURRENT' && queue.failed !== null && Array.isArray(queue.failed_classes)) {
    sum = 0;
    unknown = 0;
    for (const item of queue.failed_classes) {
      if (!Number.isSafeInteger(item.count) || item.count < 0 || !Number.isSafeInteger(sum + item.count)) {
        sum = null;
        unknown = null;
        missing_evidence.push(`${queue.queue}.failed_classes:INVALID_OR_SUM_OVERFLOW`);
        break;
      }
      sum += item.count;
      if (item.class === 'unknown') unknown += item.count;
    }
  }
  const failed = queue.failed;
  return { evaluated_at: new Date(evaluatedAt).toISOString(), reported_class_count_sum: sum, reported_unknown_class_count: unknown,
    sum_vs_failed: sum === null || failed === null ? 'UNAVAILABLE' : sum < failed ? 'LESS_THAN' : sum > failed ? 'GREATER_THAN' : 'EQUAL',
    comparability: 'UNKNOWN', unclassified_failed: null, class_coverage_ratio: null, missing_evidence };
}
export function projectFailureSummary(snapshot, sources, config, evaluatedAt = Date.parse(snapshot.generated_at)) {
  const covered = sources.filter(source => source.kind === 'postgres' || source.kind === 'redis');
  const entries = covered.map(source => {
    const readable = source.enabled && source.status === 'OK' && source.freshness === 'CURRENT';
    const metrics = new Map(readable && Array.isArray(source.metrics) ? source.metrics.map(({ metric, value }) => [metric, value]) : []);
    const missing_evidence = [];
    const value = metric => {
      const count = metrics.get(metric);
      if (Number.isSafeInteger(count) && count >= 0) return count;
      missing_evidence.push(`${metric}:${readable ? 'MISSING_OR_INVALID' : source.reason}`);
      return null;
    };
    const entry = { source_id: source.id, kind: source.kind, source_hash: source.hash, generated_at: source.generated_at, scope: source.scope, status: source.status, reason: source.reason, freshness: source.freshness };
    if (source.kind === 'postgres') entry.extraction = { total: value('extractions_total'), completed: value('extractions_completed'), failed: value('extractions_failed') };
    else {
      const diagnostics = readable && Array.isArray(source.diagnostics) ? new Map(source.diagnostics.map(d => [d.queue, d.failed_classes])) : new Map();
      entry.queues = (config.sources.find(s => s.id === source.id)?.queues ?? []).map(queue => {
        const failed = value(`${queue}.failed`);
        const failed_24h = value(`${queue}.failed_24h`);
        const failed_classes = diagnostics.get(queue);
        const valid = Array.isArray(failed_classes) && failed_classes.every(item => /^[a-z][a-z0-9_]{0,31}$/.test(item?.class) && Number.isSafeInteger(item.count) && item.count > 0);
        if (!valid) missing_evidence.push(`${queue}.failed_classes:${readable ? 'MISSING_OR_INVALID' : source.reason}`);
        return { queue, failed, failed_24h, failed_classes: valid ? failed_classes.map(({ class: category, count }) => ({ class: category, count })) : null };
      });
    }
    if (entry.queues) entry.queues = entry.queues.map(queue => ({ ...queue, class_count_diagnostics: classCountEvidence(queue, { ...entry, missing_evidence }, evaluatedAt) }));
    return { ...entry, missing_evidence };
  });
  return { schema_version: 1, derived_from_snapshot_hash: snapshot.hash, generated_at: snapshot.generated_at, coverage: { scope: 'all_configured_postgres_redis_sources', source_count: covered.length, included_source_ids: covered.map(source => source.id) }, sources: entries, missing_evidence: entries.flatMap(source => source.missing_evidence.map(reason => `${source.source_id}:${reason}`)) };
}
const descriptors = {
  search: {
    description: 'Find sanitized snapshot documents. Query is a whitelist: overview, sources, postgres, redis, rss, or podcastindex. No natural language, SQL, URLs, or content search. Citations use the configured canonical HTTPS origin; use fetch for their IDs.',
    input: z.object({ query: z.enum(['overview', 'sources', 'postgres', 'redis', 'rss', 'podcastindex']), source: idSchema.optional(), offset: z.number().int().min(0).max(16).default(0), limit: z.number().int().min(1).max(10).default(10) }).strict(),
    output: z.object({ results: z.array(z.object({ id: docId, title, url: citation }).strict()).max(10), next_offset: z.number().int().min(0).max(16).nullable(), snapshot_hash: hash }).strict()
  },
  fetch: {
    description: 'Fetch a search result ID from the pinned sanitized snapshot only. Stale counts are withheld. No network or file lookup is performed.',
    input: z.object({ id: docId }).strict(),
    output: z.object({ id: docId, title, url: citation, text: z.string().max(16000), metadata: sourceOutput, snapshot_hash: hash }).strict()
  },
  overview: {
    description: 'Business aggregate evidence per configured source. Exact counts within each source only; no deduplication or cross-source totals. UNKNOWN is never zero. Redis sources include trailing-24h completed/failed windows and sanitized failure diagnostics. RSS sources include bounded transcript-document evidence. Podcast Index sources expose discovery counts only.',
    input: z.object({ offset: z.number().int().min(0).max(16).default(0), limit: z.number().int().min(1).max(4).default(4) }).strict(),
    output: summary.extend({ sources: z.array(sourceOutput).max(4), next_offset: z.number().int().min(0).max(16).nullable(), failure_summary: failureSummary }).strict()
  },
  source_coverage: {
    description: 'Coverage of all explicitly configured sources, including disabled, missing credentials, unreachable, denied, failed and stale. No endpoints or credentials.',
    input: z.object({}).strict(),
    output: summary.extend({ sources: z.array(sourceOutput.omit({ metrics: true })).max(16) }).strict()
  }
};
export function createService(config, snapshot, now = Date.now) {
  const pinned = validateSnapshot(snapshot, config, now());
  const documents = new Map(pinned.sources.map(source => [`ns:${source.id}:${source.hash}`, source]));
  function visible(source, at = now()) {
    const stale = at - Date.parse(source.generated_at) > config.staleSeconds * 1000;
    return sourceOutput.parse({ ...source, ...(stale && source.enabled ? { status: 'UNKNOWN', reason: 'STALE', accuracy: 'unavailable', metrics: [], diagnostics: undefined, documents: undefined } : {}), freshness: stale ? 'STALE' : 'CURRENT' });
  }
  function identity(id, source) { return { id, title: titles[source.kind], url: `${config.citationOrigin}/evidence/${id}` }; }
  function invoke(name, raw) {
    const descriptor = Object.hasOwn(descriptors, name) ? descriptors[name] : undefined;
    if (!descriptor) throw new PolicyError('UNKNOWN_TOOL');
    const parsed = descriptor.input.safeParse(raw);
    if (!parsed.success) throw new PolicyError('INVALID_ARGUMENTS');
    const args = parsed.data;
    let output;
    if (name === 'search') {
      if (args.source && !pinned.sources.some(s => s.id === args.source)) throw new PolicyError('INVALID_ARGUMENTS');
      const found = [...documents].filter(([, s]) => (!args.source || args.source === s.id) && (['overview', 'sources'].includes(args.query) || s.kind === args.query));
      const end = args.offset + args.limit;
      output = { results: found.slice(args.offset, end).map(([id, s]) => identity(id, s)), next_offset: end < found.length ? end : null, snapshot_hash: pinned.hash };
    } else if (name === 'fetch') {
      const source = documents.get(args.id);
      if (!source) throw new PolicyError('NOT_FOUND');
      const data = visible(source);
      output = { ...identity(args.id, source), text: JSON.stringify(data), metadata: data, snapshot_hash: pinned.hash };
    } else {
      const at = name === 'overview' ? now() : undefined;
      const sources = name === 'overview' ? pinned.sources.map(source => visible(source, at)) : pinned.sources.map(visible);
      output = { snapshot_hash: pinned.hash, generated_at: pinned.generated_at, started_at: pinned.started_at, duration_ms: pinned.duration_ms, refresh_seconds: pinned.refresh_seconds, stale_after_seconds: pinned.stale_after_seconds, configured: sources.length,
        enabled: sources.filter(s => s.enabled).length, ok: sources.filter(s => s.status === 'OK').length,
        unknown: sources.filter(s => s.status === 'UNKNOWN').length, disabled: sources.filter(s => s.status === 'DISABLED').length,
        sources: name === 'overview' ? sources.slice(args.offset, args.offset + args.limit) : sources.map(source => { const { metrics, ...coverage } = source; void metrics; return coverage; }),
        ...(name === 'overview' ? { next_offset: args.offset + args.limit < sources.length ? args.offset + args.limit : null, failure_summary: projectFailureSummary(pinned, sources, config, at) } : {}) };
    }
    const result = descriptor.output.parse(output);
    if (Buffer.byteLength(JSON.stringify(result)) * 2 + 1024 > MAX_OUTPUT) throw new PolicyError('OUTPUT_LIMIT');
    return result;
  }
  function server() {
    const sdk = new Server({ name: 'nanosparks', version: '0.1.0' }, { capabilities: { tools: {} } });
    sdk.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: Object.entries(descriptors).map(([name, d]) => ({ name, description: d.description, inputSchema: z.toJSONSchema(d.input), outputSchema: z.toJSONSchema(d.output), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } })) }));
    sdk.setRequestHandler(CallToolRequestSchema, async request => {
      try {
        const data = invoke(request.params.name, request.params.arguments ?? {});
        return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
      } catch (error) {
        if (error instanceof PolicyError) return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: error.code }) }] };
        throw new McpError(ErrorCode.InternalError, 'Request failed');
      }
    });
    return sdk;
  }
  return { invoke, server };
}
