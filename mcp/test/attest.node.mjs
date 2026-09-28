import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { keyPatterns, parseAclUser, issueRedisAttestation, verifyRedisAttestation, verifyRedisAcl, ATTESTATION_PUBKEY_ENV } from '../src/attest.mjs';
import { redisCounts } from '../src/collect.mjs';
import { credentials } from '../src/policy.mjs';
import { source, fixtureDir, fixtureEnvironment } from './helpers.mjs';

const rs = source('fixture-redis', 'redis');
const USER = 'nanosparks_mcp_counts';
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const env = { [ATTESTATION_PUBKEY_ENV]: publicKey.export({ format: 'der', type: 'spki' }).toString('base64') };

function aclReply({ on = true, nopass = false, commands = '-@all +llen +zcard +zcount +zrange +xrange', keys = keyPatterns(rs).join(' '), channels = '', selectors = [] } = {}) {
  return ['flags', [...(on ? ['on'] : []), ...(nopass ? ['nopass'] : [])], 'passwords', ['30c952fab122c3f9759f02a6d95c3758b246b4fee239957b2d4fee46e26170c4'], 'commands', commands, 'keys', keys, 'channels', channels, 'selectors', selectors];
}
function mockAdmin(reply, { allowAllDryrun = false, dryrunError = 'NOPERM', keys = keyPatterns(rs) } = {}) {
  const allowed = new Set(keys.map(pattern => pattern.replace(/^~/, '')));
  return { acl: async (sub, ...args) => {
    if (sub === 'GETUSER') return typeof reply === 'function' ? reply() : reply;
    if (sub === 'DRYRUN') {
      const [, command, key] = args;
      if (allowAllDryrun || (['llen', 'zcard', 'zcount', 'zrange', 'xrange'].includes(command) && allowed.has(key))) return 'OK';
      throw new Error(`${dryrunError}: user ${args[0]} cannot run '${command}' on '${key}'`);
    }
    throw new Error('unexpected ACL subcommand');
  } };
}
function writeReceipt(receipt) {
  const path = join(fixtureDir('attest-receipt'), 'receipt.json');
  writeFileSync(path, JSON.stringify(receipt), { mode: 0o600 });
  return path;
}

test('exact ACL admits, signs and verifies a source-bound receipt', async () => {
  const admin = mockAdmin(aclReply());
  const patterns = await verifyRedisAcl(admin, { username: USER, queues: rs.queues });
  assert.deepEqual([...patterns].sort(), [...keyPatterns(rs)].sort());
  const receipt = await issueRedisAttestation({ source: rs, admin, username: USER, privateKey });
  assert.equal(receipt.source_id, rs.id); assert.equal(receipt.username, USER);
  assert.ok(receipt.expires_at - receipt.issued_at <= 600000 && receipt.nonce);
  const payload = verifyRedisAttestation({ source: rs, attestation: writeReceipt(receipt), username: USER, env });
  assert.equal(payload.keys_digest, receipt.keys_digest);
});

test('wrong flags, commands, keys, channels, selectors or dryrun behavior deny issuance', async () => {
  const cases = [
    mockAdmin(aclReply({ on: false })),
    mockAdmin(aclReply({ nopass: true })),
    mockAdmin(aclReply({ commands: '-@all +llen +zcard +get' })),
    mockAdmin(aclReply({ commands: '-@all +llen +zcard +zcount +zrange' })),
    mockAdmin(aclReply({ keys: keyPatterns(rs).slice(1).join(' ') })),
    mockAdmin(aclReply({ keys: [...keyPatterns(rs), '~bull:extra:wait'].join(' ') })),
    mockAdmin(aclReply({ channels: 'news' })),
    mockAdmin(aclReply({ selectors: ['x'] })),
    mockAdmin(aclReply(), { allowAllDryrun: true }),
    mockAdmin(aclReply(), { dryrunError: 'ERR' })
  ];
  for (const admin of cases) {
    await assert.rejects(verifyRedisAcl(admin, { username: USER, queues: rs.queues }), error => error instanceof Error && error.code === 'ADMISSION_UNVERIFIED');
    await assert.rejects(issueRedisAttestation({ source: rs, admin, username: USER, privateKey }), /ADMISSION_UNVERIFIED/);
  }
});

test('receipts fail closed on tampering, expiry, oversized TTL, wrong identity or missing key', async () => {
  const admin = mockAdmin(aclReply());
  const receipt = await issueRedisAttestation({ source: rs, admin, username: USER, privateKey });
  const path = writeReceipt(receipt);
  assert.ok(verifyRedisAttestation({ source: rs, attestation: path, username: USER, env }));
  const verify = over => verifyRedisAttestation({ source: rs, attestation: path, username: USER, env: { ...env, ...over.env }, ...over });
  assert.throws(() => verify({ now: receipt.expires_at + 1 }), /ADMISSION_UNVERIFIED/);
  await assert.rejects(issueRedisAttestation({ source: rs, admin, username: USER, privateKey, ttlSeconds: 601 }), /ADMISSION_UNVERIFIED/);
  assert.throws(() => verifyRedisAttestation({ source: source('other-redis', 'redis'), attestation: path, username: USER, env }), /ADMISSION_UNVERIFIED/);
  assert.throws(() => verifyRedisAttestation({ source: rs, attestation: path, username: 'someone_else', env }), /ADMISSION_UNVERIFIED/);
  assert.throws(() => verify({ env: { [ATTESTATION_PUBKEY_ENV]: '' } }), /ADMISSION_UNVERIFIED/);
  assert.throws(() => verify({ env: { [ATTESTATION_PUBKEY_ENV]: 'not-a-valid-key' } }), /ADMISSION_UNVERIFIED/);
  const tampered = writeReceipt({ ...receipt, nonce: 'tampered' });
  assert.throws(() => verifyRedisAttestation({ source: rs, attestation: tampered, username: USER, env }), /ADMISSION_UNVERIFIED/);
  const signedByOther = await issueRedisAttestation({ source: rs, admin, username: USER, privateKey: generateKeyPairSync('ed25519').privateKey });
  assert.throws(() => verifyRedisAttestation({ source: rs, attestation: writeReceipt(signedByOther), username: USER, env }), /ADMISSION_UNVERIFIED/);
  assert.throws(() => verifyRedisAttestation({ source: rs, attestation: join(fixtureDir('attest-missing'), 'none.json'), username: USER, env }), /ADMISSION_UNVERIFIED/);
});

test('parseAclUser handles the flat nested reply shape and rejects malformed replies', () => {
  const parsed = parseAclUser(aclReply());
  assert.deepEqual(parsed.flags, ['on']);
  assert.deepEqual(parsed.commands, ['-@all', '+llen', '+zcard', '+zcount', '+zrange', '+xrange']);
  assert.equal(parsed.keys.length, keyPatterns(rs).length);
  assert.deepEqual(parseAclUser(aclReply({ nopass: true })).flags, ['on', 'nopass']);
  assert.throws(() => parseAclUser(['flags', ['on']]), /ADMISSION_UNVERIFIED/);
  assert.throws(() => parseAclUser({ flags: ['on'] }), /ADMISSION_UNVERIFIED/);
});

test('redisCounts counts configured BullMQ keys only after admission, with a bounded client', async () => {
  const c = credentials(rs, fixtureEnvironment({ sources: [rs] }));
  const constructed = []; let disconnected = 0;
  const fixedNow = 1758400000000;
  class FakeRedis {
    constructor(options) { constructed.push(options); }
    on() {}
    llen(key) { return Promise.resolve(key === 'bull:ingest:wait' ? 3 : 0); }
    zcard(key) { return Promise.resolve(key === 'bull:analyze:failed' ? 2 : 0); }
    zcount(key) { return Promise.resolve(key === 'bull:ingest:completed' ? 5 : key === 'bull:analyze:failed' ? 1 : 0); }
    zrange(key) { return Promise.resolve(key === 'bull:ingest:waiting-children' ? ['job-wc', String(fixedNow - 65000)] : []); }
    xrange(key) { return Promise.resolve(key === 'bull:ingest:events' ? [[String(fixedNow - 2000) + '-0', ['event', 'failed', 'jobId', 'j1', 'failedReason', 'RAW Connection reset by peer', 'prev', 'active']]] : []); }
    disconnect() { disconnected++; }
  }
  const admin = mockAdmin(aclReply());
  const receipt = await issueRedisAttestation({ source: rs, admin, username: USER, privateKey, now: fixedNow });
  const { metrics, diagnostics } = await redisCounts(rs, c, FakeRedis, { attestation: writeReceipt(receipt), env, now: () => fixedNow });
  assert.equal(metrics.length, 20);
  assert.deepEqual(Object.fromEntries(metrics.map(m => [m.metric, m.value])), {
    'ingest.wait': 3, 'ingest.active': 0, 'ingest.paused': 0, 'ingest.delayed': 0, 'ingest.failed': 0, 'ingest.completed': 0, 'ingest.prioritized': 0, 'ingest.waiting-children': 0, 'ingest.completed_24h': 5, 'ingest.failed_24h': 0,
    'analyze.wait': 0, 'analyze.active': 0, 'analyze.paused': 0, 'analyze.delayed': 0, 'analyze.failed': 2, 'analyze.completed': 0, 'analyze.prioritized': 0, 'analyze.waiting-children': 0, 'analyze.completed_24h': 0, 'analyze.failed_24h': 1
  });
  assert.deepEqual(diagnostics.map(d => d.queue), ['ingest', 'analyze']);
  assert.deepEqual(diagnostics[0], { queue: 'ingest', waiting_children_oldest_ms: 65000, last_event_age_ms: 2000, failed_classes: [{ class: 'connection', count: 1 }] });
  assert.deepEqual(diagnostics[1], { queue: 'analyze', waiting_children_oldest_ms: null, last_event_age_ms: null, failed_classes: [] });
  assert(!JSON.stringify({ metrics, diagnostics }).includes('RAW Connection'));
  assert.equal(constructed.length, 1); assert.equal(disconnected, 1);
  assert.equal(constructed[0].username, USER); assert.equal(constructed[0].host, '127.0.0.1'); assert.equal(constructed[0].maxRetriesPerRequest, 0);
  await assert.rejects(redisCounts(rs, c, FakeRedis, { attestation: undefined, env }), /ADMISSION_UNVERIFIED/);
  assert.equal(constructed.length, 1);
});
