import { resolve } from 'node:path';
import { parseConfig, PolicyError } from './policy.mjs';
import { readBounded, loadSnapshot } from './files.mjs';
import { Audit } from './audit.mjs';
import { createService } from './service.mjs';
import { serveStdio, serveHttp, httpSettings } from './transport.mjs';

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (!['collect', 'stdio', 'http'].includes(mode)) throw new PolicyError('INVALID_COMMAND');
  const flags = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--config', '--state', '--audit', '--snapshot-hash', '--attestation'].includes(args[i]) || !args[i + 1] || flags[args[i]]) throw new PolicyError('INVALID_COMMAND');
    flags[args[i]] = args[i] === '--snapshot-hash' ? args[i + 1] : resolve(args[i + 1]);
  }
  if (!flags['--config'] || !flags['--state'] || !flags['--audit']) throw new PolicyError('INVALID_COMMAND');
  const config = parseConfig(JSON.parse(readBounded(flags['--config'])));
  if (mode === 'collect') {
    if (flags['--snapshot-hash']) throw new PolicyError('INVALID_COMMAND');
    const { collect } = await import('./collect.mjs');
    const audit = new Audit(flags['--audit']);
    let snapshot;
    try { snapshot = await collect(config, flags['--state'], { audit, attestation: flags['--attestation'] }); } finally { audit.close(); }
    process.stdout.write(JSON.stringify({ snapshot_hash: snapshot.hash, sources: snapshot.sources.length }) + '\n');
    return;
  }
  if (flags['--attestation']) throw new PolicyError('INVALID_COMMAND');
  // Serving does not resolve or import database credentials or clients.
  const settings = mode === 'http' ? httpSettings(config) : undefined;
  const service = createService(config, loadSnapshot(flags['--state'], config, flags['--snapshot-hash']));
  const audit = new Audit(flags['--audit']);
  if (mode === 'stdio') await serveStdio(service, audit);
  else {
    const server = await serveHttp(service, audit, settings);
    const stop = () => { server.close(() => { audit.close(); process.exit(0); }); server.closeAllConnections(); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  }
}
main().catch(() => { process.stderr.write('NanoSparks MCP: startup or collection rejected; inspect configuration and private state.\n'); process.exitCode = 1; });
