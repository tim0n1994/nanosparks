#!/usr/bin/env node
/**
 * Design-system regression gate. Run after `next build`.
 *
 * The bug this exists to prevent: 34 `primary-*` class references that Tailwind
 * never emitted a rule for, because no `--color-primary-*` was ever defined.
 * They type-checked, linted, and built clean — the buttons were simply
 * invisible in production. Only the compiled CSS can prove a utility exists.
 *
 * Usage: node scripts/assert-design-system.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CSS_DIR = '.next/static/chunks';
const SRC_DIR = 'src';

/** Utilities that must exist in the compiled CSS. */
const REQUIRED_CLASSES = [
  '.bg-surface{',
  '.bg-surface-raised{',
  '.bg-surface-sunken{',
  '.text-ink{',
  '.text-ink-muted{',
  '.text-ink-subtle{',
  '.text-link{',
  '.border-line{',
  '.max-w-reading{',
  '.max-w-form{',
  '.max-w-app{',
  '.text-2xs{',
  '.defer-paint{',
  '.pb-player{',
  '.bg-overlay{',
];

/** Colour ramps that must never come back. */
const BANNED_SOURCE_PATTERNS = [
  { re: /\bprimary-\d{2,3}\b/, label: 'primary-* (no such Tailwind palette)' },
  { re: /\b(?:text|bg|border|divide|ring)-gray-\d{2,3}\b/, label: 'gray-* (use the semantic tokens)' },
  { re: /\b(?:text|bg|border|divide|ring)-zinc-\d{2,3}\b/, label: 'zinc-* (use the semantic tokens)' },
  { re: /\btext-\[\d+px\]/, label: 'text-[Npx] (use the 8-step scale)' },
  { re: /\btext-muted-foreground\b|\bbg-background\b|\bring-ring\b|\bborder-input\b|\bbg-destructive\b/, label: 'shadcn token (never defined in this project)' },
];

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

const failures = [];

// ── 1. Compiled CSS actually contains the token utilities ────────────────
let css = '';
try {
  const files = walk(CSS_DIR).filter((f) => f.endsWith('.css'));
  if (files.length === 0) throw new Error('no css chunks');
  css = files.map((f) => readFileSync(f, 'utf8')).join('\n');
} catch {
  failures.push(`No compiled CSS under ${CSS_DIR} — run \`next build\` first.`);
}

if (css) {
  for (const cls of REQUIRED_CLASSES) {
    if (!css.includes(cls)) failures.push(`Missing compiled utility: ${cls}`);
  }
  for (const { re, label } of BANNED_SOURCE_PATTERNS) {
    // A banned utility appearing in the CSS means something still references it.
    if (re.source.includes('primary') && css.includes('.bg-primary-600{')) {
      failures.push(`Banned utility resurfaced in CSS: ${label}`);
    }
  }
}

// ── 2. Source is free of dead / superseded class families ────────────────
const sourceFiles = walk(SRC_DIR).filter(
  (f) => (f.endsWith('.tsx') || f.endsWith('.ts')) && !f.includes('__tests__') && !f.includes('assert-'),
);
for (const file of sourceFiles) {
  const text = readFileSync(file, 'utf8');
  for (const { re, label } of BANNED_SOURCE_PATTERNS) {
    const m = text.match(new RegExp(re.source, 'g'));
    if (m) failures.push(`${file}: ${label} → ${[...new Set(m)].slice(0, 4).join(', ')}`);
  }
}

if (failures.length > 0) {
  console.error('\n✗ Design-system gate failed:\n');
  for (const f of failures) console.error('  ' + f);
  console.error(`\n${failures.length} problem(s).\n`);
  process.exit(1);
}

console.log(`✓ Design-system gate passed (${REQUIRED_CLASSES.length} utilities present, ${sourceFiles.length} source files clean)`);
