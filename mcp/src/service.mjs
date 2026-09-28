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
    output: summary.extend({ sources: z.array(sourceOutput).max(4), next_offset: z.number().int().min(0).max(16).nullable() }).strict()
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
  function visible(source) {
    const stale = now() - Date.parse(source.generated_at) > config.staleSeconds * 1000;
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
      const sources = pinned.sources.map(visible);
      output = { snapshot_hash: pinned.hash, generated_at: pinned.generated_at, started_at: pinned.started_at, duration_ms: pinned.duration_ms, refresh_seconds: pinned.refresh_seconds, stale_after_seconds: pinned.stale_after_seconds, configured: sources.length,
        enabled: sources.filter(s => s.enabled).length, ok: sources.filter(s => s.status === 'OK').length,
        unknown: sources.filter(s => s.status === 'UNKNOWN').length, disabled: sources.filter(s => s.status === 'DISABLED').length,
        sources: name === 'overview' ? sources.slice(args.offset, args.offset + args.limit) : sources.map(source => { const { metrics, ...coverage } = source; void metrics; return coverage; }),
        ...(name === 'overview' ? { next_offset: args.offset + args.limit < sources.length ? args.offset + args.limit : null } : {}) };
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
