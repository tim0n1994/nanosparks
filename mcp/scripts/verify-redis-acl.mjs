#!/usr/bin/env node
// Operator CLI: verifies the counts user's effective Redis ACL exactly (admin
// connection) and writes a short-lived signed admission receipt. Credentials
// are read from the environment only and never printed or persisted.
import { createPrivateKey } from 'node:crypto';
import { basename, resolve } from 'node:path';
import Redis from 'ioredis';
import { parseConfig, credentials, PolicyError } from '../src/policy.mjs';
import { readBounded, atomicPrivateFile } from '../src/files.mjs';
import { issueRedisAttestation } from '../src/attest.mjs';

async function main() {
  const argv = process.argv.slice(2);
  const flags = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--config', '--source', '--out', '--ttl'].includes(argv[i]) || !argv[i + 1] || flags[argv[i]]) throw new PolicyError('INVALID_COMMAND');
    flags[argv[i]] = argv[i] === '--ttl' || argv[i] === '--source' ? argv[i + 1] : resolve(argv[i + 1]);
  }
  if (!flags['--config'] || !flags['--source'] || !flags['--out']) throw new PolicyError('INVALID_COMMAND');
  const config = parseConfig(JSON.parse(readBounded(flags['--config'])));
  const source = config.sources.find(s => s.id === flags['--source'] && s.kind === 'redis');
  if (!source) throw new PolicyError('INVALID_CONFIG');
  const keyFile = process.env.NS_MCP_REDIS_ATTESTATION_PRIVKEY_FILE;
  const keyText = keyFile ? readBounded(keyFile) : process.env.NS_MCP_REDIS_ATTESTATION_PRIVKEY;
  if (!keyText) throw new PolicyError('MISSING_CREDENTIAL');
  const privateKey = createPrivateKey(keyText);
  const c = credentials(source, process.env);
  const admin = new Redis({
    host: process.env.NS_MCP_REDIS_ADMIN_HOST, port: +process.env.NS_MCP_REDIS_ADMIN_PORT,
    username: process.env.NS_MCP_REDIS_ADMIN_USER || 'default', password: process.env.NS_MCP_REDIS_ADMIN_PASSWORD,
    enableReadyCheck: false, disableClientInfo: true, maxRetriesPerRequest: 0,
    connectTimeout: 2000, commandTimeout: 5000, retryStrategy: () => null, reconnectOnError: () => null,
    ...(source.tls === 'verify' ? { tls: {} } : {})
  });
  admin.on('error', () => {});
  try {
    await admin.ping();
    const receipt = await issueRedisAttestation({ source, admin, username: c.username, privateKey, ttlSeconds: flags['--ttl'] ? +flags['--ttl'] : 300 });
    atomicPrivateFile(flags['--out'], JSON.stringify(receipt));
    process.stdout.write(JSON.stringify({ receipt: basename(flags['--out']), source_id: source.id, keys: receipt.keys.length, expires_at: new Date(receipt.expires_at).toISOString() }) + '\n');
  } finally { admin.disconnect(); }
}
main().catch(error => {
  process.stderr.write(`verify-redis-acl: ${error instanceof PolicyError ? error.code : 'REJECTED'}\n`);
  process.exitCode = 1;
});
