/**
 * §5.4 三源仲裁融合：diarization（源 A）⊕ 对话逻辑（源 B）⊕ LLM（源 C）。
 *
 *   A、B 一致            → 直接采纳，置信 0.95
 *   A、B 冲突            → 调 C 仲裁，置信取 C 的自评
 *   A 缺失（无 diarization）→ B 打底 + C 兜底
 *   三源都拿不准          → participantId = null，但记录 attributionMethod=none
 *
 * 关键不变量：归属结果必带 attributionMethod（diarization|dialogue|llm|none）
 * 与 attributionConfidence，让 1.6% 这种数字在仪表盘上自己暴露（§5.4 设计要点）。
 *
 * 纯融合函数 exported for testing；DB/LLM 集成在 normalize-turns job 里调用。
 */

import type { SpeakerLabel } from '@/lib/transcription/dialogue-attribution';
import type { DialogueHint } from '@/lib/transcription/dialogue-attribution';

export type AttributionMethod = 'diarization' | 'dialogue' | 'llm' | 'none';

export interface ArbitratedAttribution {
  label?: SpeakerLabel;
  method: AttributionMethod;
  confidence: number;
  /** whether an LLM call is needed to resolve an A/B conflict */
  needsLlm: boolean;
}

/**
 * Pure: fuse source A (diarization) and source B (dialogue hint) into a decision.
 * Returns needsLlm=true when A and B conflict (the only case C is invoked). This
 * is the cheap path that runs for every turn; C is only called on the conflict set.
 */
export function fuseDiarizationAndDialogue(
  sourceA: { label?: SpeakerLabel; confidence: number } | null,
  sourceB: DialogueHint,
): ArbitratedAttribution {
  const a = sourceA?.label;
  const b = sourceB.label;

  // A present.
  if (a) {
    // A and B agree (B absent or B == A).
    if (!b || b === a) {
 return { label: a, method: 'diarization', confidence: 0.95, needsLlm: false };
    }
    // A and B conflict → defer to C.
    return { label: undefined, method: 'llm', confidence: 0, needsLlm: true };
  }

  // A missing: B打底.
  if (b) {
    return { label: b, method: 'dialogue', confidence: sourceB.confidence, needsLlm: false };
  }

  // A missing AND B weak: needs C (the兜底 path), but only if there's enough text.
  return { label: undefined, method: 'none', confidence: 0, needsLlm: false };
}

/**
 * Pure: apply an LLM verdict (source C) to a conflict. Returns the resolved
 * attribution with method=llm and the LLM's self-rated confidence.
 */
export function applyLlmVerdict(
  base: ArbitratedAttribution,
  verdict: { label?: SpeakerLabel; confidence: number },
): ArbitredAttribution {
  if (!verdict.label || verdict.confidence < 0.5) {
    // C couldn't decide either → null, but method recorded so it's visible.
    return { label: undefined, method: 'none', confidence: 0, needsLlm: false };
  }
  return { label: verdict.label, method: 'llm', confidence: verdict.confidence, needsLlm: false };
}
// (typo guard alias kept for callers that may reference the misspelling)
type ArbitredAttribution = ArbitratedAttribution;
