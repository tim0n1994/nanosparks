#!/usr/bin/env node
// End-to-end check for the ChatGPT tunnel proxy. The client deliberately sends
// no Authorization header: success proves the proxy injected the MCP bearer
// token. Reads the tunnel secret from var/mcp-tunnel-secret; prints statuses
// and aggregate data only, never the secret or token.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const mcpDir = path.resolve(moduleDir, '..');
const args = process.argv.slice(2);
const baseIdx = args.indexOf('--base');
const base = (baseIdx >= 0 ? args[baseIdx + 1] : 'https://nanosparks-chatgpt.udify.fun').replace(/\/$/, '');
const secret = fs.readFileSync(path.join(mcpDir, 'var', 'mcp-tunnel-secret'), 'utf8').trim();
const url = `${base}/${secret}/mcp`;

async function call(body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    for (const line of text.split('\n')) {
      if (line.startsWith('data: ')) {
        payload = JSON.parse(line.slice('data: '.length));
        break;
      }
    }
  }
  return { status: res.status, payload };
}

const init = await call({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'chatgpt-proxy-verify', version: '0.1.0' },
  },
});
console.log('initialize', init.status, init.payload?.result?.serverInfo?.name ?? 'NO_SERVER_INFO');

const list = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
const tools = list.payload?.result?.tools?.map(tool => tool.name) ?? [];
console.log('tools/list', list.status, tools.join(','));

const overview = await call({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'overview', arguments: {} } });
const summary = JSON.stringify(overview.payload?.result ?? overview.payload)?.slice(0, 600);
console.log('tools/call overview', overview.status, summary);

const ok = init.status === 200 && list.status === 200 && overview.status === 200 && tools.length > 0;
console.log(ok ? 'VERIFY_OK' : 'VERIFY_FAILED');
process.exit(ok ? 0 : 1);
