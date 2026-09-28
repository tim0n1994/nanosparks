import { sign, verify, createPublicKey, randomUUID } from 'node:crypto';
import { readBounded } from './files.mjs';
import { canonical, digest, freeze, STATES, PolicyError } from './policy.mjs';

export const ATTESTATION_PUBKEY_ENV = 'NS_MCP_REDIS_ATTESTATION_PUBKEY';
export const MAX_TTL_SECONDS = 600;
export const REDIS_COMMANDS = ['-@all', '+llen', '+zcard', '+zcount', '+zrange', '+xrange'];

export function keyPatterns(source) {
  return source.queues.flatMap(queue => [...Object.keys(STATES).map(state => `~bull:${queue}:${state}`), `~bull:${queue}:events`]);
}

function admissionFailed() { throw new PolicyError('ADMISSION_UNVERIFIED'); }

export function parseAclUser(reply) {
  if (!Array.isArray(reply) || reply[0] !== 'flags') admissionFailed();
  const at = name => reply.indexOf(name);
  const marks = ['commands', 'keys', 'channels', 'selectors'].map(at);
  if (marks.some(index => index < 0) || new Set(marks).size !== 4) admissionFailed();
  const stop = name => [...marks.filter(index => index > at(name)), reply.length].sort((a, b) => a - b)[0];
  const list = value => String(value ?? '').split(/\s+/).filter(Boolean);
  return {
    flags: Array.isArray(reply[1]) ? reply[1] : list(reply[1]),
    commands: list(reply[at('commands') + 1]),
    keys: list(reply[at('keys') + 1]),
    channels: list(reply[at('channels') + 1]),
    selectors: reply.slice(at('selectors') + 1, stop('selectors')).flat()
  };
}

// Admin-side exact policy proof. Runs with an administrator connection only;
// the counts credential itself can never answer these questions.
export async function verifyRedisAcl(admin, { username, queues }) {
  if (typeof username !== 'string' || !username || !Array.isArray(queues) || !queues.length) admissionFailed();
  let reply;
  try { reply = await admin.acl('GETUSER', username); } catch { admissionFailed(); }
  const user = parseAclUser(reply);
  if (!user.flags.includes('on') || user.flags.includes('nopass')) admissionFailed();
  const same = (a, b) => [...a].sort().join('\n') === [...b].sort().join('\n');
  if (new Set(user.commands).size !== REDIS_COMMANDS.length || !same(user.commands, REDIS_COMMANDS)) admissionFailed();
  const expected = keyPatterns({ queues });
  if (user.keys.length !== expected.length || !same(user.keys, expected)) admissionFailed();
  if (user.channels.length || user.selectors.length) admissionFailed();
  const first = queues[0];
  // Redis 7 returns a denied DRYRUN as a bulk string carrying the refusal
  // text (no leading '-'), so ioredis resolves it instead of rejecting.
  const dryrun = async (command, key, ...extra) => {
    try { return await admin.acl('DRYRUN', username, command, key, ...extra); }
    catch (error) { if (error instanceof PolicyError) throw error; return error; }
  };
  const probe = async (command, key, ...extra) => {
    if (await dryrun(command, key, ...extra) !== 'OK') admissionFailed();
  };
  const deny = async (command, key, ...extra) => {
    const result = await dryrun(command, key, ...extra);
    if (result === 'OK') admissionFailed();
    if (!/NOPERM|no permissions/i.test(String(result?.message ?? result))) admissionFailed();
  };
  await probe('llen', `bull:${first}:wait`);
  await probe('zcard', `bull:${first}:delayed`);
  await probe('zcount', `bull:${first}:failed`, '(0', '+inf');
  await probe('zrange', `bull:${first}:waiting-children`, '0', '0', 'WITHSCORES');
  await probe('xrange', `bull:${first}:events`, '-', '+', 'COUNT', '200');
  await deny('llen', 'nanosparks_mcp_unlisted_probe');
  await deny('xrange', 'nanosparks_mcp_unlisted_probe', '-', '+');
  await deny('get', `bull:${first}:wait`);
  await deny('lpush', `bull:${first}:wait`, 'probe');
  return expected;
}

export async function issueRedisAttestation({ source, admin, username, privateKey, ttlSeconds = 300, now = Date.now, nonce = randomUUID() }) {
  const ttl = Math.floor(ttlSeconds);
  if (!(ttl >= 1 && ttl <= MAX_TTL_SECONDS)) admissionFailed();
  const keys = await verifyRedisAcl(admin, { username, queues: source.queues });
  const issued_at = Math.floor(typeof now === 'function' ? now() : now);
  const payload = { v: 1, source_id: source.id, username, keys, keys_digest: digest(keys), issued_at, expires_at: issued_at + ttl * 1000, nonce };
  const signature = sign(null, Buffer.from(canonical(payload)), privateKey);
  return { ...payload, signature: signature.toString('base64') };
}

function attestationPublicKey(text) {
  const trimmed = String(text ?? '').trim();
  try {
    if (trimmed.includes('-----BEGIN')) return createPublicKey(trimmed);
    const der = Buffer.from(trimmed, 'base64');
    if (der.length === 32) return createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), der]), format: 'der', type: 'spki' });
    if (der.length === 44) return createPublicKey({ key: der, format: 'der', type: 'spki' });
  } catch { admissionFailed(); }
  admissionFailed();
}

export function verifyRedisAttestation({ source, attestation, username, env = process.env, now = Date.now() } = {}) {
  if (typeof attestation !== 'string' || !attestation) admissionFailed();
  let receipt;
  try { receipt = JSON.parse(readBounded(attestation, 8192)); } catch { admissionFailed(); }
  const at = Math.floor(typeof now === 'function' ? now() : now);
  if (!receipt || typeof receipt !== 'object' || receipt.v !== 1) admissionFailed();
  if (receipt.source_id !== source.id || receipt.username !== username) admissionFailed();
  const expected = keyPatterns(source);
  if (!Array.isArray(receipt.keys) || receipt.keys.length !== expected.length ||
    [...receipt.keys].sort().join('\n') !== [...expected].sort().join('\n')) admissionFailed();
  if (receipt.keys_digest !== digest(expected)) admissionFailed();
  for (const field of ['issued_at', 'expires_at']) if (!Number.isSafeInteger(receipt[field])) admissionFailed();
  const ttl = receipt.expires_at - receipt.issued_at;
  if (ttl < 1000 || ttl > MAX_TTL_SECONDS * 1000) admissionFailed();
  if (receipt.issued_at > at + 60000 || receipt.expires_at <= at) admissionFailed();
  if (typeof receipt.nonce !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(receipt.nonce)) admissionFailed();
  if (typeof receipt.signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(receipt.signature)) admissionFailed();
  const { signature, ...payload } = receipt;
  let valid = false;
  try { valid = verify(null, Buffer.from(canonical(payload)), attestationPublicKey(env?.[ATTESTATION_PUBKEY_ENV]), Buffer.from(signature, 'base64')); }
  catch { admissionFailed(); }
  if (!valid) admissionFailed();
  return freeze(payload);
}
