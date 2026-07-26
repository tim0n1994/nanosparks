/**
 * §5.4 源 B：对话逻辑归属（纯规则，零成本，零 LLM）。
 *
 * 不依赖音频/声纹，只从转写文本与轮次结构推断说话人切换。出奇地强：
 *   - 问句之后大概率换人
 *   - "对/嗯/是的"这类回应词归属于「上一句的听者」
 *   - 长独白中间的短插话通常是另一个人
 *   - 主持人开场/收尾的位置先验
 *
 * 性能：PRD 实测 7395 段 <100ms。纯函数，可单测；与 diarization（源 A）和 LLM（源 C）
 * 在 attribution-arbiter 里融合。
 */

const RESPONSE_TOKENS = [
  '对', '嗯', '是的', '对的', '没错', '确实', '是的呀', '诶', '啊对',
  'right', 'yeah', 'yes', 'exactly', 'sure', 'mhm', 'uh-huh', 'yep', 'correct',
];

/** Pure: a turn is a "response" if it opens with a backchannel/affirmation token. */
export function isResponseTurn(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  // Whole turn is short AND starts with a response token → it's a listener reaction.
  return RESPONSE_TOKENS.some((tok) => t.startsWith(tok.toLowerCase())) && t.length <= 24;
}

/** Pure: a turn ends in a question mark or opens with a question word. */
export function isQuestionTurn(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/[?？]\s*$/.test(t)) return true;
  return /^(what|why|how|when|where|who|which|do you|are you|can you|could you|so|什么|为什么|怎么|如何|哪里|是不是|能不能|那你|所以)/i.test(t);
}

export type SpeakerLabel = string;

export interface DialogueHint {
  /** suggested speaker for this turn (may be undefined = no hint) */
  label?: SpeakerLabel;
  /** confidence in the dialogue-only signal, 0..1 */
  confidence: number;
  /** why */
  reason: 'response_to_prev' | 'after_question_switch' | 'short_interruption' | 'opening_host' | 'closing_host' | 'none';
}

/**
 * Pure: derive per-turn dialogue hints from the turn sequence + known speaker
 * roles. Takes the list of turns (with optional prior diarization label + text +
 * role) and returns a hint per turn. No DB, no LLM.
 *
 * @param turns ordered by time; each may carry a `diarizationLabel` from source A
 *              (used only to know "who spoke before" for response attribution).
 * @param knownSpeakers the speaker labels known to appear (e.g. ['SPEAKER_00','SPEAKER_01']).
 */
export function dialogueAttribution(
  turns: Array<{ text: string; role?: string | null; diarizationLabel?: SpeakerLabel | null; startMs: number; endMs: number }>,
  knownSpeakers: SpeakerLabel[] = [],
): DialogueHint[] {
  const hints: DialogueHint[] = [];
  const speakers = knownSpeakers.length >= 2 ? knownSpeakers : [];
  const otherOf = (label?: SpeakerLabel) => {
    if (!label || speakers.length < 2) return undefined;
    return speakers.find((s) => s !== label);
  };

  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    const prev = i > 0 ? turns[i - 1] : null;
    const next = i < turns.length - 1 ? turns[i + 1] : null;

    // Opening host prior: first substantive turn is usually the host.
    if (i === 0 && t.role === 'host') {
      hints.push({ label: undefined, confidence: 0.4, reason: 'opening_host' });
      continue;
    }
    // Closing host prior: last short turn near the end is often the host wrapping up.
    if (i === turns.length - 1 && t.role === 'host' && t.text.length <= 60) {
      hints.push({ label: undefined, confidence: 0.3, reason: 'closing_host' });
      continue;
    }

    // Response turn → belongs to the listener (the OTHER speaker of the previous turn).
    if (isResponseTurn(t.text)) {
      const prevSpeaker = prev?.diarizationLabel ?? undefined;
      const listener = otherOf(prevSpeaker);
      hints.push({ label: listener, confidence: 0.7, reason: 'response_to_prev' });
      continue;
    }

    // After a question, the next turn likely switches speaker.
    if (prev && isQuestionTurn(prev.text)) {
      const prevSpeaker = prev.diarizationLabel ?? undefined;
      const answerer = otherOf(prevSpeaker);
      hints.push({ label: answerer, confidence: 0.65, reason: 'after_question_switch' });
      continue;
    }

    // Short interruption in the middle of a long monologue → the other speaker.
    const isShort = (t.endMs - t.startMs) <= 4000 && t.text.length <= 40;
    const prevWasLong = prev && (prev.endMs - prev.startMs) > 20000;
    const nextIsLong = next && (next.endMs - next.startMs) > 20000;
    if (isShort && (prevWasLong || nextIsLong)) {
      const monologuer = (prevWasLong ? prev?.diarizationLabel : next?.diarizationLabel) ?? undefined;
      const interrupter = otherOf(monologuer);
      hints.push({ label: interrupter, confidence: 0.6, reason: 'short_interruption' });
      continue;
    }

    hints.push({ confidence: 0, reason: 'none' });
  }
  return hints;
}
