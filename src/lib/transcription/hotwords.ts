/**
 * Show-level hot-word / terminology glossary (PRD §A2 热词 API 挂节目级术语词典).
 *
 * Per-show glossaries correct domain terms, host names, and jargon during the
 * LLM correction pass (solves 痛点 #5 "专有名词/人名转错"). Stored in the Setting
 * table under `glossary.<showKey>` so they're tunable without a redeploy.
 *
 * showKey is derived from the show title (slugified) so all episodes of a show
 * share one glossary; uploads with no show title fall back to a per-conversation key.
 */

import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import type { CorrectionGlossary } from './correction-pass';

/** Slugify a show title into a stable Setting key suffix. */
export function showKeyFromTitle(showTitle: string | null | undefined): string {
  const base = (showTitle ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return base || 'default';
}

/** The Setting key under which a show's glossary is stored. */
export function glossarySettingKey(showTitle: string | null | undefined): string {
  return `glossary.${showKeyFromTitle(showTitle)}`;
}

/** Load a show's glossary from the Setting table. Returns empty on miss/parse error. */
export async function loadShowGlossary(showTitle: string | null | undefined): Promise<CorrectionGlossary> {
  const key = glossarySettingKey(showTitle);
  try {
    const row = await prisma.setting.findUnique({ where: { key } });
    if (!row) return {};
    const parsed = JSON.parse(row.value) as { terms?: Record<string, string> };
    return { terms: parsed.terms ?? {} };
  } catch (err) {
    logger.warn('glossary load failed', { key, error: String(err) });
    return {};
  }
}

/** Persist a show's glossary (upsert). Used by the settings API. */
export async function saveShowGlossary(
  showTitle: string | null | undefined,
  terms: Record<string, string>,
): Promise<void> {
  const key = glossarySettingKey(showTitle);
  await prisma.setting.upsert({
    where: { key },
    update: { value: JSON.stringify({ terms }) },
    create: { key, value: JSON.stringify({ terms }) },
  });
  logger.info('glossary saved', { key, termCount: Object.keys(terms).length });
}

/** Validate a glossary terms map (wrong→right, non-empty strings). Pure logic. */
export function validateGlossaryTerms(terms: unknown): { ok: boolean; terms?: Record<string, string>; error?: string } {
  if (terms === null || typeof terms !== 'object') {
    return { ok: false, error: 'terms must be an object' };
  }
  const entries = Object.entries(terms as Record<string, unknown>);
  if (entries.length > 200) {
    return { ok: false, error: 'too many terms (max 200)' };
  }
  const clean: Record<string, string> = {};
  for (const [k, v] of entries) {
    if (typeof k !== 'string' || k.trim().length === 0) {
      return { ok: false, error: `invalid term key: ${k}` };
    }
    if (typeof v !== 'string' || v.length === 0) {
      return { ok: false, error: `invalid value for "${k}"` };
    }
    clean[k.trim()] = v;
  }
  return { ok: true, terms: clean };
}

/**
 * §5.5 glossary auto-growth: extract high-confidence proper nouns (capitalized
 * Latin tokens / CJK names) from corrected turns and merge them into the show
 * glossary as self→self entries (so they're protected from future mis-correction).
 * This is the infra compounding the PRD describes — episode N's term errors feed
 * the glossary so episode N+1 corrects them automatically. Pure helper exported.
 */
export function extractGlossaryCandidates(texts: string[]): string[] {
  const out = new Set<string>();
  for (const t of texts) {
    // Latin proper nouns (≥3 chars, Capitalized, not sentence-start common words).
    const latin = t.match(/\b[A-Z][a-zA-Z]{2,}\b/g) ?? [];
    for (const w of latin) out.add(w);
    // CJK runs of 2-4 chars that look like names (heuristic: contain no common verbs).
    const cjk = t.match(/[\u4e00-\u9fff]{2,4}/g) ?? [];
    for (const w of cjk) out.add(w);
  }
  // Cap and dedupe; filter trivial noise.
  return [...out].filter((w) => w.length >= 2).slice(0, 100);
}

/** §5.5: grow a show's glossary with newly-seen candidates (idempotent merge). */
export async function growShowGlossary(
  showTitle: string | null | undefined,
  newCandidates: string[],
): Promise<number> {
  if (newCandidates.length === 0) return 0;
  const existing = await loadShowGlossary(showTitle);
  const terms = { ...(existing.terms ?? {}) };
  let added = 0;
  for (const cand of newCandidates) {
    // self→self: protects the term from being "corrected" away next episode.
    if (!(cand in terms)) { terms[cand] = cand; added++; }
  }
  if (added > 0) await saveShowGlossary(showTitle, terms);
  return added;
}
