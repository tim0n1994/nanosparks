/**
 * postbuild — copy static + public assets into the standalone server dir.
 *
 * Next.js `output: 'standalone'` intentionally excludes client static assets
 * (.next/static: JS chunks, CSS, fonts) and the public/ folder from the
 * standalone bundle. The runtime server needs them served under /_next/static,
 * otherwise every chunk 404s and pages ship as un-hydrated HTML (no JS at all).
 *
 * Mirrors the two COPY lines in the Dockerfile:
 *   COPY --from=builder /app/.next/static ./.next/static
 *   COPY --from=builder /app/public ./public
 *
 * Idempotent: safe to run on every build.
 */
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const standalone = join(root, '.next', 'standalone');

if (!existsSync(standalone)) {
  console.log('[copy-standalone-assets] no standalone dir, skipping');
  process.exit(0);
}

// Ensure .next exists inside standalone before copying into it.
mkdirSync(join(standalone, '.next'), { recursive: true });

const staticSrc = join(root, '.next', 'static');
const staticDst = join(standalone, '.next', 'static');
if (existsSync(staticSrc)) {
  cpSync(staticSrc, staticDst, { recursive: true, force: true });
  console.log('[copy-standalone-assets] copied .next/static -> standalone/.next/static');
} else {
  console.warn('[copy-standalone-assets] WARNING: .next/static missing');
}

const publicSrc = join(root, 'public');
const publicDst = join(standalone, 'public');
if (existsSync(publicSrc)) {
  cpSync(publicSrc, publicDst, { recursive: true, force: true });
  console.log('[copy-standalone-assets] copied public -> standalone/public');
} else {
  // No public dir is fine — many apps have none. Don't create an empty one.
  console.log('[copy-standalone-assets] no public dir, skipping');
}
