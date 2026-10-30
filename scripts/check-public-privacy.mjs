#!/usr/bin/env node
import { lstat, readFile, readlink } from 'node:fs/promises';
import { extname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const allowedPrivateIpPaths = new Set([
  'src/__tests__/pii/redactor.test.ts',
]);

const patterns = [
  {
    category: 'personal-home-path',
    regex: /(?<![A-Za-z0-9_.])\/(?:Users|home)\/(?!(?:username|user)(?:\/|[\s"'<>]|$))[^/\s"'<>]+/,
  },
  {
    category: 'rfc1918-address',
    regex: /(?<![A-Za-z0-9_.])(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?![A-Za-z0-9_.])/,
  },
  {
    category: 'tailscale-address',
    regex: /(?<![A-Za-z0-9_.])100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}(?![A-Za-z0-9_.])/,
  },
];

function markerPairs(data) {
  const entries = data?.markers ?? data;
  if (!entries) return [];
  if (Array.isArray(entries)) {
    return entries.flatMap((entry) => {
      if (Array.isArray(entry)) return [entry];
      if (typeof entry === 'string') return [];
      return [[String(entry.category ?? 'private-marker'), String(entry.value ?? entry.secret ?? '')]];
    });
  }
  return Object.entries(entries).filter(([, value]) => typeof value === 'string' && value);
}

function isTextPath(path, sample) {
  if (/\.(?:png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|woff2?|ttf|otf|mp3|mp4|mov|wav|db|sqlite)$/i.test(path)) return false;
  if (extname(path) === '.svg') return true;
  return !sample.includes(0);
}

async function main() {
  const { stdout } = await execFileAsync('git', ['ls-files', '-z'], { maxBuffer: 32 * 1024 * 1024 });
  const paths = stdout.split('\0').filter(Boolean);
  const findings = [];
  const markersPath = process.env.PRIVACY_MARKERS_PATH;
  const markers = markersPath ? markerPairs(JSON.parse(await readFile(markersPath, 'utf8'))) : [];

  for (const path of paths) {
    // Git publishes the link target, never the contents of the destination.
    const stat = await lstat(path);
    const bytes = stat.isSymbolicLink() ? Buffer.from(await readlink(path)) : await readFile(path);
    if (!isTextPath(path, bytes.subarray(0, 4096))) continue;
    const text = bytes.toString('utf8');
    for (const { category, regex } of patterns) {
      if (category === 'rfc1918-address' && allowedPrivateIpPaths.has(path)) continue;
      if (regex.test(text)) findings.push({ path, category });
    }
    for (const [category, value] of markers) {
      if (text.includes(value)) findings.push({ path, category: 'marker:' + category });
    }
  }

  if (findings.length) {
    console.error('publication privacy check failed (values withheld):');
    for (const finding of findings) console.error(`${finding.path}: ${finding.category}`);
    process.exitCode = 1;
    return;
  }
  console.log(`publication privacy check passed: ${paths.length} tracked files${markers.length ? ', exact markers enabled' : ''}`);
}

main().catch((error) => {
  console.error(`publication privacy check error: ${error.message}`);
  process.exitCode = 1;
});
