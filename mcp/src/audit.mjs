import { constants, openSync, fstatSync, closeSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest, PolicyError } from './policy.mjs';
import { privateDirectory } from './files.mjs';

const TOOLS = new Set(['search', 'fetch', 'overview', 'source_coverage']);
const METHODS = new Set(['initialize', 'notifications/initialized', 'tools/list', 'ping', 'collector/postgres', 'collector/redis', 'collector/rss', 'collector/podcastindex', 'collector/cache', 'citation/fetch']);
const STATUSES = new Set(['STARTED', 'OK', 'RPC_ERROR', 'TOOL_ERROR', 'AUTH_REJECTED', 'REJECTED', 'INTERNAL_ERROR', 'DISABLED', 'MISSING_CREDENTIAL', 'INVALID_CREDENTIAL_CONFIG', 'UNREACHABLE', 'ACCESS_DENIED', 'ADMISSION_UNVERIFIED', 'COLLECTION_FAILED']);
export class Audit {
  constructor(path, maxBytes = 10 * 1024 * 1024) {
    privateDirectory(dirname(path));
    this.fd = openSync(path, constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    const stat = fstatSync(this.fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid() || (stat.mode & 0o077)) { closeSync(this.fd); throw new PolicyError('AUDIT_POLICY'); }
    this.maxBytes = maxBytes;
  }
  begin(message) {
    const tool = message?.method === 'tools/call' ? (TOOLS.has(message.params?.name) ? message.params.name : 'unknown') : (METHODS.has(message?.method) ? message.method : 'transport');
    return { requestId: randomUUID(), tool, args_hash: digest(message?.params?.arguments ?? message?.params ?? null), start: performance.now() };
  }
  append(context, status) {
    if (!STATUSES.has(status)) throw new PolicyError('AUDIT_POLICY');
    const entry = { ts: new Date().toISOString(), requestId: context.requestId, tool: context.tool, args_hash: context.args_hash, status, duration_ms: Math.max(0, Math.round(performance.now() - context.start)) };
    const line = JSON.stringify(entry) + '\n';
    if (fstatSync(this.fd).size + Buffer.byteLength(line) > this.maxBytes) throw new PolicyError('AUDIT_FULL');
    writeSync(this.fd, line);
  }
  close() { closeSync(this.fd); }
}

export class Limits {
  constructor({ concurrency = 4, requestsPerMinute = 120 } = {}, clock = Date.now) {
    this.max = concurrency; this.rate = requestsPerMinute; this.clock = clock;
    this.active = 0; this.window = clock(); this.used = 0;
  }
  enter() {
    const now = this.clock();
    if (now - this.window >= 60000) { this.window = now; this.used = 0; }
    // Count rejected requests against the rate budget as well.
    if (++this.used > this.rate || this.active >= this.max) throw new PolicyError('LIMIT_EXCEEDED');
    this.active++;
    let released = false;
    return () => { if (!released) { released = true; this.active--; } };
  }
}
