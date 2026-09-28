#!/usr/bin/env node
// ChatGPT cloud connectors cannot attach a custom Authorization header, so
// this local proxy terminates a secret-bearing URL path and injects the MCP
// bearer token before forwarding to the MCP HTTP server (same pattern as
// Eagleye's mcp/chatgpt-proxy.js). Binds 127.0.0.1 only. Never logs URLs,
// because every forwarded URL embeds the tunnel secret.

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const varDir = path.resolve(moduleDir, '..', 'var');

const PORT = Number(process.argv[2] || process.env.NS_MCP_CHATGPT_PROXY_PORT || 7559);
const UPSTREAM_PORT = Number(process.env.NS_MCP_UPSTREAM_PORT || 7558);
const UPSTREAM_AUTHORITY = `127.0.0.1:${UPSTREAM_PORT}`;

const TOKEN = process.env.NS_MCP_HTTP_TOKEN ?? '';
if (!/^[A-Za-z0-9_-]{43,256}$/.test(TOKEN)) {
  console.error('[chatgpt-proxy] NS_MCP_HTTP_TOKEN missing or malformed');
  process.exit(78);
}

const SECRET_PATH =
  process.env.NS_MCP_CHATGPT_TUNNEL_SECRET_PATH ?? path.join(varDir, 'mcp-tunnel-secret');

function ensureSecret() {
  try {
    const existing = fs.readFileSync(SECRET_PATH, 'utf8').trim();
    if (existing) return existing;
  } catch {}
  const generated = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_PATH, `${generated}\n`, { mode: 0o600 });
  console.log(`[chatgpt-proxy] generated tunnel secret at ${SECRET_PATH}`);
  return generated;
}

const SECRET = ensureSecret();
const secretDigest = crypto.createHash('sha256').update(SECRET).digest();
function secretMatches(candidate) {
  const provided = crypto.createHash('sha256').update(String(candidate ?? '')).digest();
  return crypto.timingSafeEqual(provided, secretDigest);
}

const EVIDENCE_ID = /^ns:[a-z][a-z0-9_-]{0,31}:[0-9a-f]{64}$/;

function reject(res, code) {
  if (res.headersSent) return res.destroy();
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ error: 'Not found' }));
}

const server = http.createServer((req, res) => {
  const segments = (req.url ?? '').split('/').filter(Boolean);
  let route = null;
  if (segments.length >= 2 && secretMatches(segments[0])) {
    const rest = segments.slice(1).join('/');
    if (rest === 'mcp' || rest === 'healthz') route = rest;
    else if (rest.startsWith('evidence/') && EVIDENCE_ID.test(rest.slice('evidence/'.length))) route = rest;
  }
  if (route === null) return reject(res, 404);
  if (route === 'healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, upstream: UPSTREAM_AUTHORITY }));
    return;
  }
  // Clients never send credentials here; the proxy injects them. Refuse any
  // client-provided Authorization header instead of honoring or merging it.
  if (req.headers.authorization !== undefined) return reject(res, 403);
  const upstreamPath = route === 'mcp' ? '/mcp' : `/${route}`;
  const upstream = http.request(
    {
      host: '127.0.0.1',
      port: UPSTREAM_PORT,
      path: upstreamPath,
      method: req.method,
      headers: { ...req.headers, host: UPSTREAM_AUTHORITY, authorization: `Bearer ${TOKEN}` },
    },
    upstreamRes => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    }
    res.end(JSON.stringify({ error: 'MCP upstream unavailable' }));
  });
  req.pipe(upstream);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(
    `[chatgpt-proxy] listening on http://127.0.0.1:${PORT}/<secret>/{mcp,evidence,healthz} -> ${UPSTREAM_AUTHORITY}`,
  );
});
