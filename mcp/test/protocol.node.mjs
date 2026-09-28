import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { publishSnapshot } from '../src/files.mjs';
import { createService } from '../src/service.mjs';
import { serveHttp } from '../src/transport.mjs';
import { Audit } from '../src/audit.mjs';
import { MAX_BODY } from '../src/policy.mjs';
import { configuration, snapshot, fixtureDir, capture } from './helpers.mjs';

const fixtureToken = 'unit-test-fixture-only-not-a-real-secret-1234567890';
const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'fixture', version: '1' } } };
const call = (id, name, args = {}) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });

test('official SDK stdio initialize/list/call/search/fetch and malicious argument invariant', async () => {
  const dir = fixtureDir('sdk-stdio'); const config = configuration(); const state = join(dir, 'state');
  publishSnapshot(state, snapshot(config)); const configPath = join(dir, 'config.json'); writeFileSync(configPath, JSON.stringify(config));
  const auditPath = join(dir, 'audit.jsonl');
  const client = new Client({ name: 'fixture-sdk-client', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: ['src/cli.mjs', 'stdio', '--config', configPath, '--state', state, '--audit', auditPath], cwd: resolve('.'), env: { PATH: process.env.PATH }, stderr: 'pipe' });
  let stderr = ''; transport.stderr?.on('data', chunk => { stderr += chunk; });
  let listed, overview, search, document;
  try {
    await client.connect(transport); assert.equal(client.getServerVersion().name, 'nanosparks');
    listed = await client.listTools(); assert.deepEqual(listed.tools.map(t => t.name), ['search', 'fetch', 'overview', 'source_coverage']);
    assert(listed.tools.every(t => t.annotations.readOnlyHint && !t.annotations.openWorldHint && t.outputSchema));
    overview = await client.callTool({ name: 'overview', arguments: {} }); assert.equal(overview.structuredContent.configured, 3);
    search = await client.callTool({ name: 'search', arguments: { query: 'postgres' } });
    document = await client.callTool({ name: 'fetch', arguments: { id: search.structuredContent.results[0].id } });
    assert.deepEqual(JSON.parse(document.content[0].text), document.structuredContent);
    assert.match(document.structuredContent.url, /^https:\/\/nanosparks-mcp\.example\.invalid\/evidence\//);
    const malicious = await client.callTool({ name: 'search', arguments: { query: 'PII_SENTINEL@example.invalid SELECT secret FROM users' } });
    assert.equal(malicious.isError, true); assert(!JSON.stringify(malicious).includes('PII_SENTINEL'));
  } finally { await client.close(); }
  const audit = readFileSync(auditPath, 'utf8'); assert(!audit.includes('PII_SENTINEL')); assert(audit.includes('TOOL_ERROR')); assert.equal(stderr, '');
  capture('sdk-stdio', { server: 'nanosparks', listed, overview, search, document, artifact_directory: dir, actual_stdio_protocol: true, production: false });
});

test('stdio rejects batches and oversized frames before tool execution, records protocol errors', async () => {
  const dir = fixtureDir('stdio-rejection'); const config = configuration(); const state = join(dir, 'state'); publishSnapshot(state, snapshot(config));
  const configPath = join(dir, 'config.json'); writeFileSync(configPath, JSON.stringify(config)); const auditPath = join(dir, 'audit.jsonl');
  const child = spawn(process.execPath, ['src/cli.mjs', 'stdio', '--config', configPath, '--state', state, '--audit', auditPath], { env: { PATH: process.env.PATH } });
  let output = '', stderr = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdin.write(JSON.stringify([call(1, 'overview'), call(2, 'overview')]) + '\n');
  // Delay the oversized frame until the first rejection proves startup and parsing completed.
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('stdio timeout')), 5000); child.stdout.once('data', () => { clearTimeout(timer); resolve(); }); });
  child.stdin.end('x'.repeat(MAX_BODY + 1) + '\n');
  await new Promise((resolve, reject) => { child.once('exit', code => code === 0 ? resolve() : reject(new Error('child failed'))); });
  const audit = readFileSync(auditPath, 'utf8').trim().split('\n').map(JSON.parse);
  assert(audit.every(row => row.tool !== 'overview')); assert(audit.filter(row => row.status === 'RPC_ERROR').length >= 2); assert.equal(stderr, '');
  assert(output.trim().split('\n').map(JSON.parse).every(message => message.error));
  capture('stdio-rejection', { replies: output.trim().split('\n').map(JSON.parse), audit, artifact_directory: dir });
});

async function fixtureServer(overrides = {}) {
  const dir = fixtureDir('http'); const config = configuration(); const audit = new Audit(join(dir, 'audit.jsonl'));
  const server = await serveHttp(createService(config, snapshot(config)), audit, { ...config.http, token: fixtureToken, port: 0, ...overrides });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { dir, base, server, audit, close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); audit.close(); } };
}
function rawRequest(base, { body = init, headers = {}, path = '/mcp', method = 'POST', raw } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(base + path, { method, headers: { Authorization: `Bearer ${fixtureToken}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers } }, res => {
      let text = ''; res.on('data', chunk => { text += chunk; }); res.on('end', () => resolve({ status: res.statusCode, text }));
    }); req.on('error', reject); req.end(method === 'GET' ? undefined : raw ?? JSON.stringify(body));
  });
}

test('official SDK Streamable HTTP and canonical protected citation route work on loopback fixture', async () => {
  const f = await fixtureServer(); const client = new Client({ name: 'http-fixture', version: '1' });
  let listed, coverage, citation;
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(f.base + '/mcp'), { requestInit: { headers: { Authorization: `Bearer ${fixtureToken}`, Origin: 'https://chatgpt.com' } } }));
    listed = await client.listTools(); coverage = await client.callTool({ name: 'source_coverage', arguments: {} });
    assert.equal(coverage.structuredContent.configured, 3);
    const search = await client.callTool({ name: 'search', arguments: { query: 'sources', limit: 1 } });
    const document = await client.callTool({ name: 'fetch', arguments: { id: search.structuredContent.results[0].id } });
    const path = new URL(document.structuredContent.url).pathname;
    citation = await rawRequest(f.base, { path, method: 'GET' }); assert.equal(citation.status, 200); assert.deepEqual(JSON.parse(citation.text), document.structuredContent);
    assert.equal((await rawRequest(f.base, { path, method: 'GET', headers: { Authorization: '' } })).status, 401);
  } finally { await client.close(); await f.close(); }
  capture('sdk-http', { listed, coverage, citation, artifact_directory: f.dir, actual_streamable_http: true, production_or_chatgpt: false });
});

test('HTTP auth/host/origin/path/body/batch/malicious arguments fail closed and audit outcomes without PII', async () => {
  const f = await fixtureServer(); const responses = [];
  try {
    const cases = [
      [{ headers: { Authorization: '' } }, 401], [{ headers: { Authorization: 'Bearer PII_SENTINEL@example.invalid' } }, 401],
      [{ headers: { Host: 'evil.example.invalid' } }, 403], [{ headers: { Origin: 'https://evil.example.invalid' } }, 403],
      [{ path: '/mcp?token=PII_SENTINEL' }, 404], [{ method: 'GET' }, 405],
      [{ headers: { 'Content-Type': 'text/plain' } }, 415],
      [{ raw: '{"secret":"PII_SENTINEL"' }, 400],
      [{ body: [call(10, 'overview'), call(11, 'overview')] }, 400],
      [{ raw: 'x'.repeat(MAX_BODY + 1), headers: { 'Content-Length': String(MAX_BODY + 1) } }, 413],
      [{ body: { jsonrpc: '2.0', id: 4, method: 'PII_SENTINEL' } }, 400]
    ];
    for (const [options, expected] of cases) { const response = await rawRequest(f.base, options); assert.equal(response.status, expected); assert(!response.text.includes('PII_SENTINEL')); responses.push({ expected, ...response }); }
    const malicious = await rawRequest(f.base, { body: call(20, 'search', { query: 'PII_SENTINEL@example.invalid' }) });
    assert.equal(JSON.parse(malicious.text).result.isError, true); assert(!malicious.text.includes('PII_SENTINEL')); responses.push(malicious);
    const rpc = await rawRequest(f.base, { body: { jsonrpc: '2.0', id: 21, method: 'tools/call', params: { name: 12 } } });
    assert(JSON.parse(rpc.text).error); responses.push(rpc);
  } finally { await f.close(); }
  const audit = readFileSync(join(f.dir, 'audit.jsonl'), 'utf8');
  assert(!audit.includes(fixtureToken)); assert(!audit.includes('PII_SENTINEL'));
  for (const expected of ['AUTH_REJECTED', 'RPC_ERROR', 'TOOL_ERROR']) assert(audit.includes(expected));
  const rows = audit.trim().split('\n').map(JSON.parse); assert(!rows.some(row => row.tool === 'overview'));
  capture('http-policy', { responses, audit_statuses: rows.map(r => r.status), artifact_directory: f.dir });
});

test('real HTTP JSON-RPC accepts bounded string IDs while audit uses its own opaque IDs', async () => {
  const f = await fixtureServer(); const ids = ['init-fixture-uuid', 'list-fixture-uuid', 'call-fixture-uuid']; const replies = [];
  try {
    for (const body of [{ ...init, id: ids[0] }, { jsonrpc: '2.0', id: ids[1], method: 'tools/list' }, call(ids[2], 'source_coverage')]) {
      const response = await rawRequest(f.base, { body }); const data = JSON.parse(response.text);
      assert.equal(response.status, 200); assert.equal(data.id, body.id); assert(data.result); replies.push(data);
    }
    const negative = await rawRequest(f.base, { body: call(-7, 'source_coverage') });
    assert.equal(JSON.parse(negative.text).id, -7); assert(JSON.parse(negative.text).result);
    const refused = await rawRequest(f.base, { body: { ...init, id: 'PII_SENTINEL@example.invalid' } });
    assert.equal(refused.status, 400); assert(!refused.text.includes('PII_SENTINEL'));
  } finally { await f.close(); }
  const audit = readFileSync(join(f.dir, 'audit.jsonl'), 'utf8');
  assert(ids.every(id => !audit.includes(id))); assert(!audit.includes('PII_SENTINEL'));
  capture('string-request-ids', { replies, raw_request_ids_absent_from_audit: true, artifact_directory: f.dir });
});

test('HTTP rejected auth consumes rate budget and slow body consumes concurrency before execution', async () => {
  const rate = await fixtureServer({ requestsPerMinute: 2 });
  try {
    assert.equal((await rawRequest(rate.base, { headers: { Authorization: '' } })).status, 401);
    assert.equal((await rawRequest(rate.base, { headers: { Authorization: '' } })).status, 401);
    assert.equal((await rawRequest(rate.base)).status, 429);
  } finally { await rate.close(); }
  const concurrency = await fixtureServer({ concurrency: 1 });
  const slow = http.request(concurrency.base + '/mcp', { method: 'POST', headers: { Authorization: `Bearer ${fixtureToken}`, 'Content-Type': 'application/json', 'Content-Length': '100' } });
  slow.on('error', () => {}); slow.write('{');
  await new Promise(resolve => slow.once('socket', socket => socket.once('connect', resolve)));
  try { assert.equal((await rawRequest(concurrency.base)).status, 429); }
  finally { slow.destroy(); await concurrency.close(); }
  capture('http-limits', { rate_auth_rejections_counted: true, concurrency_rejected_before_body_execution: true, artifact_directories: [rate.dir, concurrency.dir] });
});
