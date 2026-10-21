#!/usr/bin/env node
/**
 * Route first-load JS gzip budget gate for CI.
 *
 * Reads .next/app-build-manifest.json (written by `next build`), gzip-sizes
 * (node:zlib level 6) the union of JS chunks each route ships, and compares
 * per-route gzip KB against thresholds in budgets.json.
 *
 *   node scripts/ci-budget.mjs            check mode: exit 1 if any route is
 *                                         over budget or has no baseline
 *   node scripts/ci-budget.mjs --update   seed mode (LOCAL ONLY, never in CI):
 *                                         rewrite budgets.json as
 *                                         measured gzip KB x 1.15, rounded
 *
 * budgets.json shape: { "routes": { "/": 123 } }  (whole gzip KB)
 * No dependencies — node stdlib only, so it runs right after `npm run build`
 * without an install step of its own.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NEXT_DIR = join(ROOT, '.next');
const BUDGETS_PATH = join(ROOT, 'budgets.json');
const MANIFEST_PATH = join(NEXT_DIR, 'app-build-manifest.json');
const UPDATE = process.argv.includes('--update');

if (!existsSync(MANIFEST_PATH)) {
  console.error(`[ci-budget] missing ${MANIFEST_PATH} — run \`npm run build\` first`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
// app-build-manifest.json is { "pages": { "/route": ["static/chunks/...js"] } }
// in some Next versions and a flat map in others — accept both.
const pages = manifest.pages && typeof manifest.pages === 'object' ? manifest.pages : manifest;

function routeGzipKb(files) {
  const seen = new Set();
  let bytes = 0;
  for (const rel of files) {
    if (typeof rel !== 'string' || !rel.endsWith('.js')) continue;
    if (seen.has(rel)) continue;
    seen.add(rel);
    const abs = join(NEXT_DIR, rel);
    if (!existsSync(abs)) {
      console.error(`[ci-budget] manifest references missing chunk: ${rel}`);
      process.exit(1);
    }
    bytes += gzipSync(readFileSync(abs), { level: 6 }).length;
  }
  return bytes / 1024;
}

// Measure every route that ships at least one JS chunk.
const measured = Object.entries(pages)
  .filter(([route, files]) => route.startsWith('/') && Array.isArray(files))
  .map(([route, files]) => [route, routeGzipKb(files)])
  .filter(([, kb]) => kb > 0)
  .sort(([a], [b]) => a.localeCompare(b));

if (measured.length === 0) {
  console.error('[ci-budget] no routes with JS chunks found in app-build-manifest.json');
  process.exit(1);
}

if (UPDATE) {
  const routes = {};
  for (const [route, kb] of measured) routes[route] = Math.round(kb * 1.15);
  const payload = {
    $comment: [
      'Per-route first-load JS gzip budgets (whole KB), enforced by scripts/ci-budget.mjs in CI.',
      'Seeded from a local `next build` as measured gzip KB x 1.15, rounded.',
      'Re-baseline locally with: node scripts/ci-budget.mjs --update (never in CI).',
    ].join(' '),
    routes,
  };
  writeFileSync(BUDGETS_PATH, `${JSON.stringify(payload, null, 2)}\n`);
}

if (!existsSync(BUDGETS_PATH)) {
  console.error(`[ci-budget] missing ${BUDGETS_PATH} — seed it locally with \`node scripts/ci-budget.mjs --update\` and commit it`);
  process.exit(1);
}
const budgets = JSON.parse(readFileSync(BUDGETS_PATH, 'utf8')).routes ?? {};

const over = [];
const missing = [];
const rows = [];
for (const [route, kb] of measured) {
  const budget = budgets[route];
  if (typeof budget !== 'number') {
    missing.push(route);
    rows.push([route, kb.toFixed(1), '-', 'NO BASELINE']);
  } else if (kb > budget) {
    over.push([route, kb, budget]);
    rows.push([route, kb.toFixed(1), String(budget), `OVER +${(kb - budget).toFixed(1)}`]);
  } else {
    rows.push([route, kb.toFixed(1), String(budget), 'ok']);
  }
}
const stale = Object.keys(budgets).filter((r) => !measured.some(([m]) => m === r));

const w = Math.max(...rows.map(([r]) => r.length), 5);
console.log(`${'route'.padEnd(w)}gzip KB  budget KB  status`);
for (const [route, kb, budget, status] of rows) {
  console.log(`${route.padEnd(w)}${kb.padStart(8)}${budget.padStart(11)}  ${status}`);
}
if (stale.length) {
  console.log(`[ci-budget] note: budgeted routes no longer built: ${stale.join(', ')}`);
}

if (UPDATE) {
  console.log(`[ci-budget] --update: wrote ${BUDGETS_PATH} (baseline x1.15, rounded to whole KB)`);
  process.exit(0);
}
if (missing.length) {
  console.error(`[ci-budget] FAIL — no budget baseline for: ${missing.join(', ')} (run scripts/ci-budget.mjs --update locally and commit budgets.json)`);
}
if (over.length) {
  for (const [route, kb, budget] of over) {
    console.error(`[ci-budget] FAIL — ${route}: ${kb.toFixed(1)} KB gzip > budget ${budget} KB`);
  }
}
if (missing.length || over.length) process.exit(1);
console.log(`[ci-budget] OK — ${measured.length} route(s) within budget`);
