/**
 * V2/T-V2-9: lightweight local/global query router.
 *
 * Decides whether an "Ask" question should hit local retrieval (a specific
 * person's / episode's claims) or global synthesis (cross-corpus overview of a
 * topic) using cheap keyword/structure heuristics. Pure + unit-tested so the
 * routing policy is explicit rather than a hidden prompt.
 *
 * The heuristic intentionally avoids an extra LLM call (the spec allowed a cheap
 * model, but a deterministic rule is cheaper, faster, and debuggable).
 */

export type QueryScope = 'local' | 'global';

export interface QueryRouteResult {
  scope: QueryScope;
  reason: string;
}

const GLOBAL_HINTS = [
  // asks for an overall take / pattern across the corpus
  '整体', '总体', '总的', '所有', '大家', '普遍', '一致性', '看法', '怎么看待', '怎么看',
  'overall', 'in general', 'consensus', 'everyone', 'across', 'patterns', 'compare', 'comparison',
  '主题', 'topic', '趋势', 'trend', '总结', 'summarize', 'summary',
];

const LOCAL_HINTS = [
  // scoped to a person, episode, or specific claim
  '他', '她', '某人说', '认为', '主张', '这个观点', '这一集', '这集', '刚才',
  'he said', 'she said', 'this episode', 'this claim', 'specifically', 'exactly', 'here',
  '某某', '嘉宾', 'host', '主持人',
];

function norm(s: string): string {
  return s.toLowerCase();
}

/** Pure routing decision. Local wins ties (safer default for grounded answers). */
export function routeQuery(query: string): QueryRouteResult {
  const q = norm(query ?? '');
  if (!q) return { scope: 'local', reason: 'empty' };

  let globalScore = 0;
  let localScore = 0;
  for (const h of GLOBAL_HINTS) if (q.includes(norm(h))) globalScore += 2;
  for (const h of LOCAL_HINTS) if (q.includes(norm(h))) localScore += 2;

  // Long, multi-faceted questions lean global.
  const wordCount = query.split(/\s+/).filter(Boolean).length;
  if (wordCount >= 12) globalScore += 1;
  // A quoted mention of a person/episode name leans local.
  if (/[「「"].*?[」"」]/.test(query) || /[:：]/.test(query)) localScore += 1;

  if (globalScore > localScore) return { scope: 'global', reason: `global=${globalScore} local=${localScore}` };
  return { scope: 'local', reason: `global=${globalScore} local=${localScore}` };
}
