/**
 * Sensitive-word filter (B1) — PRD §B1 敏感词过滤.
 *
 * Scans generated copy before publish for words that trigger platform throttling
 * (小红书限流主因, per research). Categories: medical claims, absolute-superlative
 * terms, lead-generation/引流 words. Returns hits + a rewrite suggestion.
 *
 * The wordbank is a plain data file so it can be tuned per-platform without code
 * changes, and the scanner is a pure function tested in isolation.
 */

export type SensitiveCategory = 'medical' | 'absolute' | 'lead_generation' | 'forbidden';

export interface SensitiveHit {
  term: string;
  category: SensitiveCategory;
  startIndex: number;
  endIndex: number;
  /** Suggested replacement (empty string = suggest deletion). */
  suggestion: string;
}

/** A categorized sensitive-word entry. */
interface SensitiveEntry {
  term: string;
  category: SensitiveCategory;
  suggestion?: string;
}

// Baseline wordbank. Tunable; extend per platform. Kept conservative on purpose:
// only high-confidence platform-throttle triggers.
const WORDBANK: SensitiveEntry[] = [
  // 绝对化用语 (广告法 + 小红书限流高频)
  { term: '最好', category: 'absolute', suggestion: '很好' },
  { term: '最佳', category: 'absolute', suggestion: '优秀' },
  { term: '第一', category: 'absolute', suggestion: '领先' },
  { term: '国家级', category: 'absolute', suggestion: '' },
  { term: '顶级', category: 'absolute', suggestion: '出色' },
  { term: '100%', category: 'absolute', suggestion: '大概率' },
  { term: '绝对', category: 'absolute', suggestion: '' },
  // 医疗/功效宣称 (需资质，普通账号发布即风险)
  { term: '治愈', category: 'medical', suggestion: '有助于改善' },
  { term: '疗效', category: 'medical', suggestion: '效果' },
  { term: '包治', category: 'medical', suggestion: '' },
  { term: '根治', category: 'medical', suggestion: '改善' },
  { term: '减肥', category: 'medical', suggestion: '身材管理' },
  { term: '壮阳', category: 'medical', suggestion: '' },
  // 引流词 (导流到私域，平台打击)
  { term: '加微信', category: 'lead_generation', suggestion: '' },
  { term: '微信号', category: 'lead_generation', suggestion: '' },
  { term: '加我', category: 'lead_generation', suggestion: '' },
  { term: '私聊', category: 'lead_generation', suggestion: '评论区见' },
  { term: '扫码', category: 'lead_generation', suggestion: '' },
  { term: '加群', category: 'lead_generation', suggestion: '' },
  // 违禁
  { term: '代购', category: 'forbidden', suggestion: '' },
  { term: '刷单', category: 'forbidden', suggestion: '' },
];

/** Lowercase + trim a copy string for case-insensitive matching. */
function normalize(text: string): string {
  return text.toLowerCase();
}

/**
 * Scan copy for sensitive words. Returns all hits in document order.
 * Pure function — no I/O.
 */
export function scanSensitiveWords(text: string): SensitiveHit[] {
  if (!text) return [];
  const lower = normalize(text);
  const hits: SensitiveHit[] = [];

  for (const entry of WORDBANK) {
    const needle = normalize(entry.term);
    if (!needle) continue;
    let from = 0;
    // find all occurrences (case-insensitive, position reported in original text)
    while (from <= lower.length) {
      const idx = lower.indexOf(needle, from);
      if (idx < 0) break;
      hits.push({
        term: entry.term,
        category: entry.category,
        startIndex: idx,
        endIndex: idx + entry.term.length,
        suggestion: entry.suggestion ?? '',
      });
      from = idx + entry.term.length;
    }
  }

  hits.sort((a, b) => a.startIndex - b.startIndex);
  return hits;
}

/**
 * Rewrite copy by applying suggestions for all hits. Hits with empty suggestion
 * are deleted; overlapping hits resolve by earliest index. Best-effort: the
 * generator should still surface hits for human review before publish.
 */
export function applySensitiveRewrites(text: string): { rewritten: string; applied: number } {
  const hits = scanSensitiveWords(text);
  if (hits.length === 0) return { rewritten: text, applied: 0 };

  // Walk original text; at each hit boundary, emit suggestion (or skip if empty).
  let out = '';
  let cursor = 0;
  let applied = 0;
  for (const h of hits) {
    if (h.startIndex < cursor) continue; // overlap, already consumed
    out += text.slice(cursor, h.startIndex);
    if (h.suggestion) {
      out += h.suggestion;
      applied++;
    } else {
      // deletion counts as applied (term removed)
      applied++;
    }
    cursor = h.endIndex;
  }
  out += text.slice(cursor);
  return { rewritten: out, applied };
}

/** Categories present in a scan result (for UI grouping). */
export function summarizeCategories(hits: SensitiveHit[]): SensitiveCategory[] {
  return Array.from(new Set(hits.map((h) => h.category)));
}

/** True when a copy passes with zero hits (safe to publish). */
export function isClean(text: string): boolean {
  return scanSensitiveWords(text).length === 0;
}
