#!/usr/bin/env node
/**
 * Route first-load JS gzip budget gate for CI.
 *
 * Next 16 builds with Turbopack, which does NOT emit the webpack-era
 * app-build-manifest.json. The per-route client-JS mapping lives in
 * .next/server/app/<route>/page_client-reference-manifest.js instead: for every
 * page, that manifest lists each reachable client module and the chunk files
 * it lives in. First-load JS per route is therefore computed as:
 *
 *   gzip(rootMainFiles + polyfillFiles from .next/build-manifest.json
 *        + every chunk referenced by an eager (async:false) client module
 *          of that page's manifest)
 *
 * Chunks are gzip-sized with node:zlib level 6 and compared per route against
 * thresholds in budgets.json (whole KB).
 *
 *   node scripts/ci-budget.mjs            check: exit 1 if any route is over
 *                                         budget or has no baseline entry
 *   node scripts/ci-budget.mjs --update   seed (LOCAL ONLY, never in CI):
 *                                         rewrite budgets.json as measured
 *                                         gzip KB x 1.15, rounded to whole KB
 *
 * budgets.json shape: { "routes": { "/dashboard": 123 } }
 * Node stdlib only — runs right after `npm run build`, no install of its own.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NEXT_DIR = join(ROOT, '.next');
const BUDGETS_PATH = join(ROOT, 'budgets.json');
const UPDATE = process.argv.includes('--update');

// --- shared runtime every route loads -------------------------------------
const buildManifestPath = join(NEXT_DIR, 'build-manifest.json');
if (!existsSync(buildManifestPath)) {
  console.error(`[ci-budget] missing ${buildManifestPath} — run \`npm run build\` first`);
  process.exit(1);
}
const buildManifest = JSON.parse(readFileSync(buildManifestPath, 'utf8'));
// lowPriorityFiles (_buildManifest/_ssgManifest) load after hydration and are
// excluded, matching the "first load" idea; polyfills + root runtime are not.
const sharedChunks = [...(buildManifest.polyfillFiles ?? []), ...(buildManifest.rootMainFiles ?? [])]
  .filter((f) => typeof f === 'string' && f.endsWith('.js'));

// --- per-route client chunk sets ------------------------------------------
function findPageManifests(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir.path ?? dir, entry.name);
    if (entry.isDirectory()) out.push(...findPageManifests(p));
    else if (entry.name === 'page_client-reference-manifest.js') out.push(p);
  }
  return out;
}

// The manifest is a JS assignment: globalThis.__RSC_MANIFEST["/x/page"] = {...};
// the payload itself is a strict-JSON object literal.
function parseRouteManifest(file) {
  const src = readFileSync(file, 'utf8');
  const eq = src.indexOf('= {');
  if (eq === -1) throw new Error(`no manifest payload in ${file}`);
  const payload = src.slice(eq + 2).trim().replace(/;\s*$/, '');
  const data = JSON.parse(payload);
  const key = /__RSC_MANIFEST\["([^"]+)"\]/.exec(src)?.[1] ?? null;
  return { key, data };
}

const serverAppDir = join(NEXT_DIR, 'server', 'app');
const sizeCache = new Map();
function gzipKb(rel) {
  const norm = rel.replace(/^\/_next\//, '');
  if (sizeCache.has(norm)) return sizeCache.get(norm);
  const abs = join(NEXT_DIR, norm);
  if (!existsSync(abs)) {
    console.error(`[ci-budget] manifest references missing chunk: ${norm}`);
    process.exit(1);
  }
  const kb = gzipSync(readFileSync(abs), { level: 6 }).length / 1024;
  sizeCache.set(norm, kb);
  return kb;
}

const routes = [];
for (const file of findPageManifests(serverAppDir)) {
  const { key, data } = parseRouteManifest(file);
  if (!key) continue;
  // "/dashboard/page" -> "/dashboard"; "/page" -> "/"; skip non-page and
  // framework-internal boundaries (_global-error, _not-found, ...).
  if (!key.endsWith('/page')) continue;
  const route = key.slice(0, -'/page'.length) || '/';
  if (route.startsWith('/_')) continue;

  const chunks = new Set();
  for (const mod of Object.values(data.clientModules ?? {})) {
    if (mod.async) continue; // lazy (next/dynamic) — not first-load
    for (const c of mod.chunks ?? []) {
      if (typeof c === 'string' && c.endsWith('.js')) chunks.add(c);
    }
  }
  let kb = 0;
  for (const c of new Set([...sharedChunks, ...chunks])) kb += gzipKb(c);
  routes.push([route, kb, relative(serverAppDir, file)]);
}
routes.sort(([a], [b]) => a.localeCompare(b));

if (routes.length === 0) {
  console.error('[ci-budget] no page_client-reference-manifest.js routes found under .next/server/app');
  process.exit(1);
}

// --- budgets ---------------------------------------------------------------
if (UPDATE) {
  const entries = {};
  for (const [route, kb] of routes) entries[route] = Math.round(kb * 1.15);
  writeFileSync(
    BUDGETS_PATH,
    `${JSON.stringify(
      {
        $comment: [
          'Per-route first-load JS gzip budgets (whole KB), enforced by scripts/ci-budget.mjs in CI.',
          'Seeded from a local `next build` as measured gzip KB x 1.15, rounded.',
          'Re-baseline locally with: node scripts/ci-budget.mjs --update (never in CI).',
        ].join(' '),
        routes: entries,
      },
      null,
      2,
    )}\n`,
  );
}
if (!existsSync(BUDGETS_PATH)) {
  console.error(`[ci-budget] missing ${BUDGETS_PATH} — seed it locally with \`node scripts/ci-budget.mjs --update\` and commit it`);
  process.exit(1);
}
const budgets = JSON.parse(readFileSync(BUDGETS_PATH, 'utf8')).routes ?? {};

const over = [];
const missing = [];
const rows = [];
for (const [route, kb] of routes) {
  const budget = budgets[route];
  if (typeof budget !== 'number') {
    missing.push(route);
    rows.push([route, kb, null, 'NO BASELINE']);
  } else if (kb > budget) {
    over.push([route, kb, budget]);
    rows.push([route, kb, budget, `OVER +${(kb - budget).toFixed(1)}`]);
  } else {
    rows.push([route, kb, budget, 'ok']);
  }
}
const stale = Object.keys(budgets).filter((r) => !routes.some(([m]) => m === r));

const w = Math.max(...rows.map(([r]) => r.length), 5);
console.log(`${'route'.padEnd(w)} gzip KB  budget KB  status`);
for (const [route, kb, budget, status] of rows) {
  const b = budget === null ? '-' : String(budget);
  console.log(`${route.padEnd(w)}${kb.toFixed(1).padStart(8)}${b.padStart(11)}  ${status}`);
}
if (stale.length) console.log(`[ci-budget] note: budgeted routes no longer built: ${stale.join(', ')}`);

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
console.log(`[ci-budget] OK — ${routes.length} route(s) within budget`);
