// Local-only setup: provisions MCP roles on the local nanosparks stack and
// writes 0600 credential files. Never prints secret values.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import pg from 'pg';
import Redis from 'ioredis';

const ROOT = '/Users/chillbit/Proj/nanosparks';
const MCP = join(ROOT, 'mcp');
const VAR = join(MCP, 'var');
mkdirSync(VAR, { recursive: true });

const newline = String.fromCharCode(10);
const unquote = value => {
  value = value.trim();
  while (value.startsWith('"') || value.startsWith(String.fromCharCode(39))) value = value.slice(1);
  while (value.endsWith('"') || value.endsWith(String.fromCharCode(39))) value = value.slice(0, -1);
  return value;
};
const dotenv = Object.fromEntries(
  readFileSync(join(ROOT, '.env'), 'utf8').split(newline)
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), unquote(l.slice(l.indexOf('=') + 1))])
);
const dbUrl = new URL(dotenv.DATABASE_URL);
const pgPort = dbUrl.port || '5432';
const pgDb = dbUrl.pathname.slice(1);
const redisPort = new URL(dotenv.REDIS_URL).port || '6379';

const pgReaderPassword = randomBytes(24).toString('hex');
const redisCountsPassword = randomBytes(24).toString('hex');
const httpToken = randomBytes(32).toString('hex');
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pubB64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
const privPem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();

const queues = ['ingest', 'transcribe', 'analyze', 'diarize', 'normalize_turns', 'retention', 'project', 'person_profile'];
const states = ['wait', 'active', 'paused', 'delayed', 'failed', 'completed', 'prioritized', 'waiting-children'];
const patterns = queues.flatMap(q => states.map(s => '~bull:' + q + ':' + s));

// 1. Postgres: revoke default PUBLIC grants (provision.sql DBA prerequisite),
// then provision roles + view and set the reader password.
const admin = new pg.Client({ host: '127.0.0.1', port: +pgPort, user: decodeURIComponent(dbUrl.username), password: decodeURIComponent(dbUrl.password), database: pgDb });
await admin.connect();
try {
  if (!/^[a-z_][a-z0-9_]*$/.test(pgDb)) throw new Error('unexpected database name');
  await admin.query('REVOKE CREATE,TEMP ON DATABASE ' + pgDb + ' FROM PUBLIC');
  await admin.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
  await admin.query('DROP SCHEMA IF EXISTS nanosparks_mcp CASCADE');
  await admin.query('DO $$ BEGIN IF EXISTS (SELECT FROM pg_roles WHERE rolname = \'nanosparks_mcp_reader\') THEN REVOKE CONNECT ON DATABASE ' + pgDb + ' FROM nanosparks_mcp_reader; END IF; END $$;');
  await admin.query('DROP ROLE IF EXISTS nanosparks_mcp_reader');
  await admin.query('DROP OWNED BY nanosparks_mcp_view_owner');
  await admin.query('DROP ROLE IF EXISTS nanosparks_mcp_view_owner');
  await admin.query(readFileSync(join(MCP, 'sql', 'provision.sql'), 'utf8'));
  if (!/^[0-9a-f]{48}$/.test(pgReaderPassword)) throw new Error('unexpected password format');
  await admin.query("ALTER ROLE nanosparks_mcp_reader PASSWORD '" + pgReaderPassword + "'");
} finally { await admin.end(); }

// 2. Redis: create the counts-only ACL user (reset semantics, exact keys).
const redisAdmin = new Redis({ host: '127.0.0.1', port: +redisPort, maxRetriesPerRequest: 0 });
redisAdmin.on('error', () => {});
try {
  await redisAdmin.acl('SETUSER', 'nanosparks_mcp_counts', 'reset', 'on', '>' + redisCountsPassword, '-@all', '+llen', '+zcard', ...patterns);
} finally { redisAdmin.disconnect(); }

// 3. Write credential/config files (0600 where secret).
const envLocal = [
  '# NanoSparks MCP local credentials. 0600, never commit, never print.',
  'NS_MCP_PRIMARY_PG_HOST=127.0.0.1',
  'NS_MCP_PRIMARY_PG_PORT=' + pgPort,
  'NS_MCP_PRIMARY_PG_DATABASE=' + pgDb,
  'NS_MCP_PRIMARY_PG_USER=nanosparks_mcp_reader',
  'NS_MCP_PRIMARY_PG_PASSWORD=' + pgReaderPassword,
  'NS_MCP_PRIMARY_REDIS_HOST=127.0.0.1',
  'NS_MCP_PRIMARY_REDIS_PORT=' + redisPort,
  'NS_MCP_PRIMARY_REDIS_USER=nanosparks_mcp_counts',
  'NS_MCP_PRIMARY_REDIS_PASSWORD=' + redisCountsPassword,
  'NS_MCP_HTTP_TOKEN=' + httpToken,
  'NS_MCP_REDIS_ATTESTATION_PUBKEY=' + pubB64,
  'NS_MCP_REDIS_ADMIN_HOST=127.0.0.1',
  'NS_MCP_REDIS_ADMIN_PORT=' + redisPort,
  'NS_MCP_REDIS_ADMIN_USER=default',
  'NS_MCP_REDIS_ATTESTATION_PRIVKEY_FILE=' + join(VAR, 'attestation-private.pem'),
].join(newline);
writeFileSync(join(VAR, 'env.local'), envLocal, { mode: 0o600 });
writeFileSync(join(VAR, 'attestation-private.pem'), privPem, { mode: 0o600 });

const config = {
  version: 1,
  citationOrigin: 'https://nanosparks-mcp.udify.fun',
  refreshSeconds: 300,
  staleSeconds: 900,
  sources: [
    { id: 'primary-db', revision: 1, kind: 'postgres', enabled: true, tls: 'loopback',
      env: { host: 'NS_MCP_PRIMARY_PG_HOST', port: 'NS_MCP_PRIMARY_PG_PORT', database: 'NS_MCP_PRIMARY_PG_DATABASE', username: 'NS_MCP_PRIMARY_PG_USER', password: 'NS_MCP_PRIMARY_PG_PASSWORD' } },
    { id: 'primary-queues', revision: 1, kind: 'redis', enabled: true, tls: 'loopback',
      queues,
      env: { host: 'NS_MCP_PRIMARY_REDIS_HOST', port: 'NS_MCP_PRIMARY_REDIS_PORT', username: 'NS_MCP_PRIMARY_REDIS_USER', password: 'NS_MCP_PRIMARY_REDIS_PASSWORD' } },
  ],
  http: { host: '127.0.0.1', port: 7558, tokenEnv: 'NS_MCP_HTTP_TOKEN', allowedOrigins: ['https://chatgpt.com'], requestsPerMinute: 120, concurrency: 4 },
};
writeFileSync(join(MCP, 'config.local.json'), JSON.stringify(config, null, 2) + newline, { mode: 0o600 });
console.log(JSON.stringify({ provisioned: ['pg PUBLIC revoke+roles+view', 'redis ACL user'], files: ['var/env.local', 'var/attestation-private.pem', 'config.local.json'], pg_db: pgDb, pg_port: pgPort, redis_port: redisPort, keys: patterns.length }));
