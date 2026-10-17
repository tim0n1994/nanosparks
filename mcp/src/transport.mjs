import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js';
import { MAX_BODY, MAX_OUTPUT, PolicyError } from './policy.mjs';
import { Limits } from './audit.mjs';

function safeError(message) {
  if (message.error) return { jsonrpc: '2.0', id: message.id, error: { code: message.error.code, message: 'Request rejected' } };
  return message;
}
function validMessage(message) {
  if (Array.isArray(message) || !JSONRPCMessageSchema.safeParse(message).success) return false;
  if (!message.method || !['initialize', 'notifications/initialized', 'tools/list', 'tools/call', 'ping'].includes(message.method)) return false;
  if (message.id !== undefined && !Number.isSafeInteger(message.id) && !(typeof message.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(message.id))) return false;
  if (message.method !== 'notifications/initialized' && message.id === undefined) return false;
  if (message.method === 'notifications/initialized' && message.id !== undefined) return false;
  return true;
}
function rpcError(id = null) { return { jsonrpc: '2.0', id, error: { code: -32600, message: 'Request rejected' } }; }

export async function serveStdio(service, audit, { input = process.stdin, output = process.stdout, limits = new Limits() } = {}) {
  const sdk = service.server();
  const transport = new StdioServerTransport(input, output, { maxBufferSize: MAX_BODY });
  const pending = new Map();
  const originalSend = transport.send.bind(transport);
  transport.send = async message => {
    const context = pending.get(message.id);
    if (context) {
      pending.delete(message.id);
      try { audit.append(context.audit, message.error ? 'RPC_ERROR' : message.result?.isError ? 'TOOL_ERROR' : 'OK'); }
      catch { await transport.close(); return; }
      finally { context.release(); }
    }
    await originalSend(safeError(message));
  };
  await sdk.connect(transport);
  const receive = transport.onmessage;
  transport.onmessage = message => {
    const context = audit.begin(message);
    let release;
    try {
      audit.append(context, 'STARTED');
      if (!validMessage(message)) {
        audit.append(context, 'RPC_ERROR');
        void originalSend(rpcError());
        return;
      }
      release = limits.enter();
      if (message.id !== undefined) {
        if (pending.has(message.id)) throw new PolicyError('DUPLICATE_ID');
        pending.set(message.id, { audit: context, release });
        receive(message);
      } else {
        receive(message); release(); audit.append(context, 'OK');
      }
    } catch {
      release?.();
      try {
        audit.append(context, 'REJECTED');
        if (validMessage(message)) {
          if (message.id !== undefined) void originalSend(rpcError(message.id));
        } else void originalSend(rpcError());
      } catch { void transport.close(); }
    }
  };
  // SDK parse and buffer errors contain input; only fixed audit labels leave this callback.
  transport.onerror = () => {
    try { audit.append(audit.begin(null), 'RPC_ERROR'); void originalSend(rpcError()); } catch { void transport.close(); }
  };
  input.once('end', () => { void sdk.close(); });
  return sdk;
}

async function readBody(req) {
  const announced = req.headers['content-length'];
  if (announced && (!/^\d+$/.test(announced) || +announced > MAX_BODY)) throw new PolicyError('BODY_LIMIT');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new PolicyError('BODY_LIMIT');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export function httpSettings(config, env = process.env) {
  const h = config.http;
  const token = h && env[h.tokenEnv];
  if (!h || h.host !== '127.0.0.1' || typeof token !== 'string' || !/^[A-Za-z0-9_-]{43,256}$/.test(token)) throw new PolicyError('INVALID_HTTP_CONFIG');
  return { ...h, token };
}
export async function serveHttp(service, audit, settings) {
  // Defense in depth for programmatic callers, not only CLI configuration.
  if (settings.host !== '127.0.0.1' || !/^[A-Za-z0-9_-]{43,256}$/.test(settings.token ?? '') || !Array.isArray(settings.allowedOrigins) || settings.allowedOrigins.some(origin => {
    try { const u = new URL(origin); return u.protocol !== 'https:' || u.origin !== origin; } catch { return true; }
  })) throw new PolicyError('INVALID_HTTP_CONFIG');
  const limits = new Limits(settings);
  const expectedAuth = Buffer.from(`Bearer ${settings.token}`);
  const server = http.createServer({ maxHeaderSize: 8192 }, async (req, res) => {
    let context = audit.begin(null), release, sdk, transport, recorded = false, requestId = null;
    const finish = status => { if (!recorded) { audit.append(context, status); recorded = true; } };
    const reject = (code, status) => {
      finish(status);
      res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Connection: 'close' });
      res.end(JSON.stringify(rpcError(requestId)));
    };
    // A bounded total request lifetime includes slow chunked bodies.
    const timeout = setTimeout(() => { try { reject(408, 'REJECTED'); } catch { res.destroy(); } req.destroy(); }, 5000);
    try {
      audit.append(context, 'STARTED');
      release = limits.enter();
      const authority = `127.0.0.1:${server.address().port}`;
      const headerCount = name => req.rawHeaders.filter((_, index) => index % 2 === 0 && req.rawHeaders[index].toLowerCase() === name).length;
      if (req.headers.host !== authority || headerCount('host') !== 1 || (req.headers.origin !== undefined && (headerCount('origin') !== 1 || !settings.allowedOrigins.includes(req.headers.origin)))) return reject(403, 'REJECTED');
      const receivedAuth = Buffer.from(req.headers.authorization ?? '');
      if (headerCount('authorization') !== 1 || receivedAuth.length !== expectedAuth.length || !timingSafeEqual(receivedAuth, expectedAuth)) return reject(401, 'AUTH_REJECTED');
      if (req.method === 'GET' && /^\/evidence\/ns:[a-z][a-z0-9_-]{0,31}:[0-9a-f]{64}$/.test(req.url ?? '')) {
        const id = req.url.slice('/evidence/'.length);
        const readContext = audit.begin({ method: 'citation/fetch', params: { id } });
        context = { ...readContext, requestId: context.requestId, start: context.start };
        let document;
        try { document = service.invoke('fetch', { id }); } catch { return reject(404, 'REJECTED'); }
        finish('OK');
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        res.end(JSON.stringify(document));
        return;
      }
      // Never route credentials or identifiers via the URL, and never trust forwarded headers.
      if (req.url !== '/mcp') return reject(404, 'REJECTED');
      if (req.method !== 'POST') return reject(405, 'REJECTED');
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '') || req.headers['content-encoding']) return reject(415, 'REJECTED');
      const body = await readBody(req);
      const parsedContext = audit.begin(body);
      context = { ...parsedContext, requestId: context.requestId, start: context.start };
      if (!validMessage(body)) return reject(400, 'RPC_ERROR');
      requestId = body.id ?? null;
      sdk = service.server();
      transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await sdk.connect(transport);
      // Keep every SDK response in memory until sanitization and terminal audit
      // succeed. The SDK never receives the real socket or ServerResponse.
      const headers = new Headers();
      for (const name of ['accept', 'content-type', 'mcp-protocol-version', 'mcp-session-id']) {
        if (typeof req.headers[name] === 'string') headers.set(name, req.headers[name]);
      }
      const response = await transport.handleRequest(new Request(`http://${authority}/mcp`, { method: 'POST', headers, body: JSON.stringify(body) }), { parsedBody: body });
      let outgoing;
      if (response.status >= 400) outgoing = rpcError(requestId);
      else if (response.status !== 202 && response.status !== 204) {
        const text = await response.text();
        if (Buffer.byteLength(text) > MAX_OUTPUT) throw new PolicyError('OUTPUT_LIMIT');
        outgoing = safeError(JSON.parse(text));
      }
      const status = response.status >= 400 || outgoing?.error ? 'RPC_ERROR' : outgoing?.result?.isError ? 'TOOL_ERROR' : 'OK';
      const bytes = outgoing ? JSON.stringify(outgoing) : '';
      finish(status);
      if (!res.destroyed && !res.writableEnded) {
        res.writeHead(response.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        res.end(bytes);
      }
    } catch (error) {
      if (res.headersSent) res.destroy();
      else {
        try { reject(error.code === 'LIMIT_EXCEEDED' ? 429 : error.code === 'BODY_LIMIT' ? 413 : error instanceof SyntaxError ? 400 : 503, error instanceof SyntaxError ? 'RPC_ERROR' : 'REJECTED'); }
        catch { res.writeHead(503, { Connection: 'close' }); res.end(); }
      }
    } finally {
      clearTimeout(timeout); release?.();
      await transport?.close(); await sdk?.close();
    }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 1000;
  server.maxRequestsPerSocket = 100;
  server.maxConnections = 32;
  server.on('clientError', (_, socket) => {
    try { audit.append(audit.begin(null), 'RPC_ERROR'); } catch { socket.destroy(); return; }
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(settings.port, '127.0.0.1', resolve); });
  return server;
}
