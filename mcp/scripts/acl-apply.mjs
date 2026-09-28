#!/usr/bin/env node
import Redis from 'ioredis';
import { resolve } from 'node:path';
import { parseConfig, credentials, PolicyError } from '../src/policy.mjs';
import { REDIS_COMMANDS, keyPatterns, parseAclUser } from '../src/attest.mjs';
import { readBounded } from '../src/files.mjs';

const same = (a, b) => [...a].sort().join('\n') === [...b].sort().join('\n');

async function main() {
  const argv = process.argv.slice(2);
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--apply') { flags['--apply'] = true; continue; }
    if (!['--config', '--source'].includes(argv[i]) || !argv[i + 1] || flags[argv[i]]) throw new PolicyError('INVALID_COMMAND');
    flags[argv[i]] = argv[i] === '--source' ? argv[i + 1] : resolve(argv[i + 1]);
    i++;
  }
  if (!flags['--config'] || !flags['--source']) throw new PolicyError('INVALID_COMMAND');
  const config = parseConfig(JSON.parse(readBounded(flags['--config'])));
  const source = config.sources.find(s => s.id === flags['--source'] && s.kind === 'redis');
  if (!source) throw new PolicyError('INVALID_CONFIG');
  const { username } = credentials(source, process.env);
  const admin = new Redis({
    host: process.env.NS_MCP_REDIS_ADMIN_HOST, port: +process.env.NS_MCP_REDIS_ADMIN_PORT,
    username: process.env.NS_MCP_REDIS_ADMIN_USER || 'default', password: process.env.NS_MCP_REDIS_ADMIN_PASSWORD,
    enableReadyCheck: false, disableClientInfo: true, maxRetriesPerRequest: 0,
    connectTimeout: 2000, commandTimeout: 5000, retryStrategy: () => null, reconnectOnError: () => null
  });
  admin.on('error', () => {});
  try {
    const expectedKeys = keyPatterns({ queues: source.queues });
    const user = parseAclUser(await admin.acl('GETUSER', username));
    const missingCommands = REDIS_COMMANDS.filter(c => !user.commands.includes(c));
    const missingKeys = expectedKeys.filter(k => !user.keys.includes(k));
    const needOn = !user.flags.includes('on');
    const before = {
      compliant: !missingCommands.length && !missingKeys.length && !needOn &&
        !user.commands.some(c => !REDIS_COMMANDS.includes(c)) && !user.keys.some(k => !expectedKeys.includes(k)),
      missing_commands: missingCommands.length, missing_keys: missingKeys.length
    };
    if (flags['--apply'] && (missingCommands.length || missingKeys.length || needOn)) {
      await admin.acl('SETUSER', username, ...needOn ? ['on'] : [], ...missingCommands, ...missingKeys);
    }
    const after = parseAclUser(await admin.acl('GETUSER', username));
    const result = {
      source_id: source.id, applied: Boolean(flags['--apply']), before,
      compliant: same(after.commands, REDIS_COMMANDS) && same(after.keys, expectedKeys) &&
        !after.channels.length && !after.selectors.length && after.flags.includes('on')
    };
    process.stdout.write(JSON.stringify(result) + '\n');
  } finally { admin.disconnect(); }
}
main().catch(error => {
  process.stderr.write(`acl-apply: ${error instanceof PolicyError ? error.code : 'REJECTED'}\n`);
  process.exitCode = 1;
});
