/**
 * P5a: follow-up engine — the core of the AI interviewer.
 *
 * Decides whether the interviewee's last answer "passes" or needs a follow-up,
 * and if so, generates the follow-up question. This is what makes the
 * interviewer feel real (PRD §3.2): it presses on vague answers, missing basis,
 * and contradictions with the interviewee's own prior claims (the differentiator
 * — a human host can't do this without hours of prep).
 *
 * Trigger rules (PRD §3.2): an answer needs a follow-up iff ANY holds:
 *   1. vague quantifier without a number ("很多" / "a lot")
 *   2. conclusion without basis
 *   3. contradicts the interviewee's prior PersonClaims (uses L2)
 *   4. dodges the question core (answer-question relevance)
 *   5. surfaces a new entity/concept worth expanding
 *
 * Follow-up chain length is capped at the host fingerprint's P75 follow-up depth.
 *
 * Pure judge + question-formulation helpers exported for testing. The LLM call
 * for free-form follow-ups is in generateFollowUpQuestion (DB-backed).
 */

import { prisma } from '@/lib/prisma';
import { hasVagueQuantifier } from '@/lib/person/host-fingerprint';
import { getLlmSettings } from '@/lib/settings';
import { OpenAIClient, ClaudeClient } from '@/lib/llm/client';

export type FollowupReason =
  | 'vague_quantifier'
  | 'conclusion_no_basis'
  | 'contradicts_prior'
  | 'dodges_question'
  | 'new_entity'
  | 'passed';

export interface FollowupDecision {
  needsFollowup: boolean;
  reason: FollowupReason;
  detail?: string;
}

/**
 * Pure: judge whether an answer needs a follow-up, given the question asked and
 * the interviewee's prior claims (for contradiction detection). No LLM call —
 * deterministic signal extraction. Returns 'passed' when no trigger fires.
 */
export function judgeAnswer(opts: {
  question: string;
  answer: string;
  priorClaims: Array<{ text: string }>;
  knownEntities: string[]; // entities already discussed (for new-entity detection)
}): FollowupDecision {
  const { question, answer, priorClaims, knownEntities } = opts;
  const ans = (answer ?? '').trim();
  if (!ans) return { needsFollowup: true, reason: 'dodges_question', detail: 'empty answer' };

  // 1. Vague quantifier without a number.
  if (hasVagueQuantifier(ans) && !/\d/.test(ans)) {
    return { needsFollowup: true, reason: 'vague_quantifier', detail: 'vague amount, no number' };
  }

  // 3. Contradicts a prior claim (keyword-overlap heuristic; precise needs embeddings).
  const ansLow = ans.toLowerCase();
  for (const c of priorClaims) {
    const claimLow = c.text.toLowerCase();
    // Cheap negation-flip detector: answer asserts opposite of a prior claim that
    // shares >=2 significant words. (Production: use embedding similarity + stance.)
    const tokens = claimLow.split(/[\s,，。.！!?？]+/).filter((w) => w.length > 2);
    const shared = tokens.filter((t) => ansLow.includes(t));
    const hasNegation = /\b(not|never|no longer|don't|won't|isn't)\b|不|没|不再|不会|不是/.test(ansLow);
    const priorPositive = !/\b(not|never|no longer|don't|won't|isn't)\b|不|没|不再|不会|不是/.test(claimLow);
    if (shared.length >= 2 && hasNegation && priorPositive) {
      return { needsFollowup: true, reason: 'contradicts_prior', detail: `vs "${c.text.slice(0, 60)}"` };
    }
  }

  // 4. Dodges the question: very short answer to a substantive question.
  const isSubstantiveQ = /\b(why|how|what|explain|tell me)\b|为什么|怎么|如何|解释|说说/.test(question.toLowerCase());
  if (isSubstantiveQ && ans.length < 25) {
    return { needsFollowup: true, reason: 'dodges_question', detail: `short answer (${ans.length} chars) to substantive question` };
  }

  // 2. Conclusion without basis: asserts but offers no because/so/due/evidence marker.
  const hasBasis = /\b(because|since|due to|so|therefore|for example|e\.g\.|data|study|research)\b|因为|由于|所以|例如|数据|研究|比如/.test(ansLow);
  if (ans.length > 60 && !hasBasis && !/\?|？/.test(ans)) {
    return { needsFollowup: true, reason: 'conclusion_no_basis', detail: 'assertion without reasoning marker' };
  }

  // 5. New entity surfaced (proper-noun-ish capitalized tokens not in known set).
  const properNouns = (ans.match(/\b[A-Z][a-zA-Z]{2,}\b/g) ?? []);
  const novel = properNouns.find((n) => !knownEntities.includes(n));
  if (novel) {
    return { needsFollowup: true, reason: 'new_entity', detail: `novel: ${novel}` };
  }

  return { needsFollowup: false, reason: 'passed' };
}

/**
 * Pure: formulate a follow-up question from the reason (no LLM). Cheap, fast,
 * deterministic — used as the default; generateFollowUpQuestion upgrades to LLM.
 */
export function formulateFollowUp(reason: FollowupReason, detail?: string): string {
  switch (reason) {
    case 'vague_quantifier': return '具体是多少？能给个数字或量级吗？';
    case 'conclusion_no_basis': return '你这么判断的依据是什么？';
    case 'contradicts_prior': return `你之前说过相关的话（${detail ?? ''}），现在怎么看这个变化？`;
    case 'dodges_question': return '能展开说说吗？我想理解你的意思。';
    case 'new_entity': return `你刚提到的${detail ?? ''}是什么？能多讲讲吗？`;
    default: return '能再展开一点吗？';
  }
}

/**
 * DB-backed: generate a context-aware follow-up via the LLM, grounded in the
 * host's style (transition phrases) and the interviewee's prior claims.
 * Falls back to formulateFollowUp if no client / on error.
 */
export async function generateFollowUpQuestion(opts: {
  question: string;
  answer: string;
  reason: FollowupReason;
  intervieweeEntityId: string;
  hostTransitionPhrase?: string;
  client?: OpenAIClient | ClaudeClient;
}): Promise<string> {
 const fallback = formulateFollowUp(opts.reason);
 try {
    const prior = await prisma.personClaim.findMany({
      where: { entityId: opts.intervieweeEntityId },
      select: { text: true },
      take: 5,
      orderBy: { firstAssertedAt: 'desc' },
    });
    const prefix = opts.hostTransitionPhrase ? `${opts.hostTransitionPhrase}，` : '';
    const client = opts.client ?? (await makeClient());
    const prompt = `你是访谈主持人。嘉宾刚回答了你的问题，但这个回答${reasonLabel(opts.reason)}（${opts.reason}）。
需要追问，但措辞要自然、像真人在对话，必要时引用他此前的观点。

你的问题：${opts.question}
嘉宾的回答：${opts.answer}
他此前的主张：${prior.map((p) => `- ${p.text.slice(0, 100)}`).join('\n') || '（暂无）'}

只输出一句追问，不要解释。开头可用"${opts.hostTransitionPhrase ?? ''}"。`;
    const res = await client.completeWithRetry([{ role: 'user', content: prompt }], 200, 2);
    const q = res.content.trim().split('\n')[0].trim();
    return q || fallback;
  } catch {
    return fallback;
  }
}

function reasonLabel(r: FollowupReason): string {
  switch (r) {
    case 'vague_quantifier': return '用了模糊量词但没给数字';
    case 'conclusion_no_basis': return '给了结论但没说依据';
    case 'contradicts_prior': return '和他此前的观点不一致';
    case 'dodges_question': return '没正面回答';
    case 'new_entity': return '提到了新概念值得展开';
    default: return '还可以再展开';
  }
}

async function makeClient(): Promise<OpenAIClient | ClaudeClient> {
  const s = await getLlmSettings();
  if (s.apiFormat === 'anthropic') return new ClaudeClient(s.apiKey, s.model, s.baseUrl);
  return new OpenAIClient(s.apiKey, s.model, s.baseUrl);
}
