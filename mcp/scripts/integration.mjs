import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import Redis from 'ioredis';
import { collect, PG_PRIVILEGES, PG_COUNTS } from '../src/collect.mjs';
import { credentials } from '../src/policy.mjs';
import { issueRedisAttestation, ATTESTATION_PUBKEY_ENV } from '../src/attest.mjs';
import { atomicPrivateFile } from '../src/files.mjs';
import { Audit } from '../src/audit.mjs';
import { configuration, source, fixtureDir, fixtureEnvironment, capture } from '../test/helpers.mjs';

// Only this invocation's randomly named, labelled containers are ever stopped.
const suffix = randomUUID().slice(0, 12);
const pgName = `nanosparks-mcp-test-pg-${suffix}`, redisName = `nanosparks-mcp-test-redis-${suffix}`;
const created = [];
const docker = args => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }).trim();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let admin, redisAdmin, reader, redisReader;
const facts = { invocation: 'npm run test:integration', production: false, disposable_only: true, containers: [pgName, redisName], checks: [] };
try {
  for (const image of ['postgres:16-alpine', 'redis:7-alpine']) docker(['image', 'inspect', image]);
  const common = ['run', '-d', '--rm', '--read-only', '--memory=256m', '--cpus=0.5', '--pids-limit=128', '--label', `nanosparks.mcp.fixture=${suffix}`, '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m'];
  docker([...common, '--name', pgName, '--tmpfs', '/var/lib/postgresql/data:rw,noexec,nosuid,size=128m', '--tmpfs', '/var/run/postgresql:rw,noexec,nosuid,size=4m', '-p', '127.0.0.1::5432', '-e', 'POSTGRES_PASSWORD=fixture-only', '-e', 'POSTGRES_DB=fixture', 'postgres:16-alpine']); created.push(pgName);
  docker([...common, '--name', redisName, '--tmpfs', '/data:rw,noexec,nosuid,size=16m', '-p', '127.0.0.1::6379', 'redis:7-alpine', 'redis-server', '--save', '', '--appendonly', 'no']); created.push(redisName);
  const pgPort = Number(docker(['port', pgName, '5432/tcp']).split(':').at(-1));
  const redisPort = Number(docker(['port', redisName, '6379/tcp']).split(':').at(-1));
  for (let i = 0; i < 100; i++) {
    const candidate = new pg.Client({ host: '127.0.0.1', port: pgPort, user: 'postgres', password: 'fixture-only', database: 'fixture', connectionTimeoutMillis: 500 });
    try { await candidate.connect(); admin = candidate; break; } catch { await candidate.end(); await sleep(200); }
  }
  assert(admin, 'Disposable Postgres did not become ready');
  await admin.query(`REVOKE CREATE,TEMP ON DATABASE fixture FROM PUBLIC;
    REVOKE CREATE ON SCHEMA public FROM PUBLIC;
    CREATE TABLE public."Conversation" (status text NOT NULL, content text);
    CREATE TABLE public."ExtractionRun" (status text NOT NULL, params jsonb);
    CREATE TABLE public."Users" (email text);
    INSERT INTO public."Conversation" VALUES ('completed','PII_SENTINEL'),('failed','PII_SENTINEL'),('pending','PII_SENTINEL');
    INSERT INTO public."ExtractionRun" VALUES ('completed','{"error":"PII_SENTINEL"}'),('failed','{"error":"PII_SENTINEL"}'),('pending','{"error":"PII_SENTINEL"}'),('running','{"error":"PII_SENTINEL"}');
    INSERT INTO public."Users" VALUES ('PII_SENTINEL@example.invalid');`);
  await admin.query(readFileSync(new URL('../sql/provision.sql', import.meta.url), 'utf8'));
  await admin.query("ALTER ROLE nanosparks_mcp_reader PASSWORD 'fixture-reader-only'");
  const config = configuration([source('fixture-pg'), { ...source('fixture-redis', 'redis'), queues: ['ingest', 'transcribe', 'analyze', 'diarize', 'normalize_turns', 'retention', 'project', 'person_profile'] }]);
  const env = fixtureEnvironment(config); const ps = config.sources[0], rs = config.sources[1];
  env[ps.env.port] = String(pgPort); env[ps.env.password] = 'fixture-reader-only'; env[rs.env.port] = String(redisPort);
  redisAdmin = new Redis({ host: '127.0.0.1', port: redisPort, maxRetriesPerRequest: 0 }); redisAdmin.on('error', () => {});
  await redisAdmin.ping();
  const fixtureNow = Date.now();
  await redisAdmin.lpush('bull:ingest:wait', 'job-fixture'); await redisAdmin.zadd('bull:analyze:failed', 1, 'job-fixture');
  await redisAdmin.zadd('bull:ingest:completed', fixtureNow - 3600000, 'job-recent', fixtureNow - 90 * 86400000, 'job-old');
  await redisAdmin.zadd('bull:analyze:failed', fixtureNow - 60000, 'job-failed-recent', fixtureNow - 2 * 86400000, 'job-failed-old');
  await redisAdmin.zadd('bull:analyze:waiting-children', fixtureNow - 120000, 'job-wc');
  await redisAdmin.xadd('bull:analyze:events', '*', 'event', 'failed', 'failedReason', 'Connection refused (ETIMEDOUT)');
  await redisAdmin.xadd('bull:analyze:events', '*', 'event', 'failed', 'failedReason', 'PII_SENTINEL@example.invalid exploded');
  const patterns = rs.queues.flatMap(q => ['wait', 'active', 'paused', 'delayed', 'failed', 'completed', 'prioritized', 'waiting-children', 'events'].map(s => `~bull:${q}:${s}`));
  await redisAdmin.acl('SETUSER', 'nanosparks_mcp_counts', 'reset', 'on', '>fixture-only-not-a-real-credential', '-@all', '+llen', '+zcard', '+zcount', '+zrange', '+xrange', ...patterns);
  const dir = fixtureDir('disposable-integration'); const audit = new Audit(join(dir, 'audit.jsonl'));
  const { publicKey: attestPublic, privateKey: attestPrivate } = generateKeyPairSync('ed25519');
  env[ATTESTATION_PUBKEY_ENV] = attestPublic.export({ format: 'der', type: 'spki' }).toString('base64');
  const keyDir = fixtureDir('attestation-key');
  const keyPath = join(keyDir, 'attestation-private.pem');
  writeFileSync(keyPath, attestPrivate.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
  const receiptPath = join(dir, 'redis-attestation.json');
  const receipt = await issueRedisAttestation({ source: rs, admin: redisAdmin, username: 'nanosparks_mcp_counts', privateKey: attestPrivate });
  atomicPrivateFile(receiptPath, JSON.stringify(receipt));
  const snap = await collect(config, dir, { env, audit, attestation: receiptPath }); audit.close();
  assert(snap.sources.every(s => s.status === 'OK'));
  assert.deepEqual(Object.fromEntries(snap.sources[0].metrics.map(m => [m.metric, m.value])), { conversations_total: 3, conversations_completed: 1, conversations_failed: 1, extractions_total: 4, extractions_completed: 1, extractions_failed: 1, extractions_pending: 1, extractions_running: 1 });
  assert.equal(snap.sources[1].metrics.find(m => m.metric === 'ingest.wait').value, 1);
  assert.equal(snap.sources[1].metrics.find(m => m.metric === 'analyze.failed').value, 3);
  assert.equal(snap.sources[1].metrics.find(m => m.metric === 'ingest.completed_24h').value, 1);
  assert.equal(snap.sources[1].metrics.find(m => m.metric === 'analyze.failed_24h').value, 1);
  const diagnostics = snap.sources[1].diagnostics;
  assert.deepEqual(diagnostics.map(d => d.queue), rs.queues);
  const ingestDiag = diagnostics.find(d => d.queue === 'ingest');
  assert.equal(ingestDiag.waiting_children_oldest_ms, null);
  assert.equal(ingestDiag.last_event_age_ms, null);
  assert.deepEqual(ingestDiag.failed_classes, []);
  const analyzeDiag = diagnostics.find(d => d.queue === 'analyze');
  assert.ok(analyzeDiag.waiting_children_oldest_ms >= 120000 && analyzeDiag.waiting_children_oldest_ms <= 300000);
  assert.ok(analyzeDiag.last_event_age_ms < 60000);
  assert.deepEqual(analyzeDiag.failed_classes, [{ class: 'timeout', count: 1 }, { class: 'unknown', count: 1 }]);
  assert(!JSON.stringify(snap).includes('PII_SENTINEL'));
  facts.checks.push('actual eight PG aggregates exact', 'actual 80 Redis metrics exact (64 state counts + 16 24h windows)', 'sanitized per-queue diagnostics with failure classes only', 'PII absent from snapshot');
  const c = credentials(ps, env);
  reader = new pg.Client({ host: c.host, port: c.port, user: c.username, password: c.password, database: c.database }); await reader.connect();
  assert.equal((await reader.query('SHOW default_transaction_read_only')).rows[0].default_transaction_read_only, 'on');
  assert.equal((await reader.query(PG_PRIVILEGES)).rows[0].permitted, true);
  assert.equal((await reader.query(PG_COUNTS)).rows[0].conversations_total, '3');
  for (const sql of ['SELECT content FROM public."Conversation"', 'SELECT params FROM public."ExtractionRun"', 'SELECT email FROM public."Users"', 'CREATE TEMP TABLE forbidden (id int)', 'CREATE SCHEMA forbidden']) {
    await assert.rejects(reader.query(sql), error => ['42501', '25006'].includes(error.code));
  }
  await reader.query('BEGIN READ ONLY');
  await assert.rejects(reader.query("INSERT INTO public.\"Conversation\" VALUES ('pending','forbidden')"), error => error.code === '25006'); await reader.query('ROLLBACK');
  await reader.query('SET default_transaction_read_only = off');
  await assert.rejects(reader.query("INSERT INTO public.\"Conversation\" VALUES ('pending','forbidden')"), error => error.code === '42501');
  await assert.rejects(reader.query("UPDATE nanosparks_mcp.business_counts SET conversations_total=99"));
  facts.checks.push('raw content/error/PII SELECT denied', 'READ ONLY denies write', 'ACL denies write even after client disables default read only', 'TEMP and schema CREATE denied');
  for (const [grant, revoke] of [
    ['GRANT TEMP ON DATABASE fixture TO PUBLIC', 'REVOKE TEMP ON DATABASE fixture FROM PUBLIC'],
    ['GRANT CREATE ON SCHEMA public TO PUBLIC', 'REVOKE CREATE ON SCHEMA public FROM PUBLIC'],
    ['GRANT SELECT ON public."Users" TO PUBLIC', 'REVOKE SELECT ON public."Users" FROM PUBLIC'],
    ["CREATE FUNCTION public.fixture_definer() RETURNS int LANGUAGE sql SECURITY DEFINER AS 'SELECT 1'", 'DROP FUNCTION public.fixture_definer()']
  ]) { await admin.query(grant); assert.equal((await reader.query(PG_PRIVILEGES)).rows[0].permitted, false); await admin.query(revoke); }
  assert.equal((await reader.query(PG_PRIVILEGES)).rows[0].permitted, true);
  facts.checks.push('PUBLIC TEMP/schema CREATE/base SELECT/SECURITY DEFINER grants detected');
  redisReader = new Redis({ host: '127.0.0.1', port: redisPort, username: 'nanosparks_mcp_counts', password: env[rs.env.password], enableReadyCheck: false, disableClientInfo: true, maxRetriesPerRequest: 0 }); redisReader.on('error', () => {});
  assert.equal(await redisReader.llen('bull:ingest:wait'), 1);
  assert.equal(await redisReader.zcount('bull:ingest:completed', 0, '+inf'), 2);
  assert.equal((await redisReader.zrange('bull:analyze:waiting-children', '0', '0', 'WITHSCORES')).length, 2);
  for (const operation of [() => redisReader.get('private'), () => redisReader.llen('unknown-key'), () => redisReader.lpush('bull:ingest:wait', 'bad'), () => redisReader.eval('return 1', 0), () => redisReader.info(), () => redisReader.xrange('nanosparks_mcp_unlisted_probe', '-', '+'), () => redisReader.xadd('bull:ingest:events', '*', 'x', 'y')]) await assert.rejects(operation(), /NOPERM/);
  facts.checks.push('Redis GET/unknown key/LPUSH/EVAL/INFO/XADD/XRANGE-unlisted denied, ZCOUNT/ZRANGE on listed keys allowed');
  await redisAdmin.acl('SETUSER', 'nanosparks_mcp_counts', 'reset', 'on', '>fixture-only-not-a-real-credential', '+@all', '~*');
  await assert.rejects(issueRedisAttestation({ source: rs, admin: redisAdmin, username: 'nanosparks_mcp_counts', privateKey: attestPrivate }), /ADMISSION_UNVERIFIED/);
  const deniedDir = fixtureDir('disposable-integration-denied'); const deniedAudit = new Audit(join(deniedDir, 'audit.jsonl'));
  const denied = await collect(config, deniedDir, { env, audit: deniedAudit, attestation: join(deniedDir, 'absent-receipt.json') }); deniedAudit.close();
  assert.equal(denied.sources[1].status, 'UNKNOWN'); assert.equal(denied.sources[1].reason, 'ADMISSION_UNVERIFIED');
  assert.deepEqual(denied.sources[1].metrics, []);
  facts.checks.push('attested Redis admission collected exact counts', 'widened ACL fails receipt issuance', 'collection without a receipt stays ADMISSION_UNVERIFIED');
  facts.snapshot = snap; facts.artifact_directory = dir;
} finally {
  await reader?.end(); await admin?.end(); redisReader?.disconnect(); redisAdmin?.disconnect();
  for (const name of created.reverse()) {
    assert.equal(docker(['inspect', '-f', '{{ index .Config.Labels "nanosparks.mcp.fixture" }}', name]), suffix);
    docker(['stop', '-t', '2', name]);
  }
}
facts.cleanup_completed = true;
capture('disposable-integration', facts);
