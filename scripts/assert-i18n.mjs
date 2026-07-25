#!/usr/bin/env node
/**
 * i18n gate.
 *
 * Two failure modes this catches, both of which shipped before:
 *   1. A `t('some.key')` whose key is not in the catalogue — `t()` silently
 *      falls back to printing the raw key, so "reader.tldr" renders on screen.
 *   2. A key present in one language but missing in the other — switching to
 *      English silently leaves Chinese (or vice versa) on the page.
 *
 * Usage: node scripts/assert-i18n.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SRC = 'src';
const MESSAGES_DIR = 'src/lib/i18n/messages';

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'generated' || entry === 'node_modules') continue;
      walk(full, out);
    } else out.push(full);
  }
  return out;
}

// ── Parse the catalogue straight from source (no build step needed) ──────
const zh = new Set();
const en = new Set();
for (const file of readdirSync(MESSAGES_DIR).filter((f) => f.endsWith('.ts'))) {
  const text = readFileSync(join(MESSAGES_DIR, file), 'utf8');
  const zhBlock = text.slice(text.indexOf('zh: {'), text.indexOf('en: {'));
  const enBlock = text.slice(text.indexOf('en: {'));
  for (const [target, block] of [
    [zh, zhBlock],
    [en, enBlock],
  ]) {
    for (const m of block.matchAll(/^\s+'([a-zA-Z0-9._]+)':/gm)) target.add(m[1]);
  }
}

const failures = [];

// ── 1. Every key must exist in both languages ────────────────────────────
for (const k of zh) if (!en.has(k)) failures.push(`Key missing from en: ${k}`);
for (const k of en) if (!zh.has(k)) failures.push(`Key missing from zh: ${k}`);

// ── 2. Every referenced key must exist ───────────────────────────────────
// Only literal `t('a.b')` calls; dynamic `t(item.key)` cannot be checked here.
const files = walk(SRC).filter(
  (f) => (f.endsWith('.tsx') || f.endsWith('.ts')) && !f.includes('/messages/'),
);
let referenced = 0;
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/\bt\(\s*'([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+)'/g)) {
    referenced++;
    if (!zh.has(m[1])) failures.push(`${file}: t('${m[1]}') has no catalogue entry`);
  }
}

if (failures.length > 0) {
  console.error('\n✗ i18n gate failed:\n');
  for (const f of [...new Set(failures)]) console.error('  ' + f);
  console.error(`\n${new Set(failures).size} problem(s).\n`);
  process.exit(1);
}

console.log(
  `✓ i18n gate passed (${zh.size} keys × 2 languages, ${referenced} literal references resolved)`,
);
