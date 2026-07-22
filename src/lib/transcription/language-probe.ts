/**
 * Language detection for ASR routing (PRD §A2: 探测首 60s 语种再路由).
 *
 * When platform/title hints are ambiguous, the PRD calls for probing the first
 * 60 seconds of audio to determine the language, then routing to the right ASR
 * provider. Rather than ffprobe the raw audio (which needs a binary + language
 * ID model), we detect from the *already-transcribed* leading segments — the
 * transcript is a reliable language signal and avoids a second inference pass.
 *
 * Used to (re-)route after a first-pass transcription, or to set Conversation.language
 * for downstream feature-gating (e.g. offering the bilingual translate button).
 */

/** Detect the dominant language of a set of transcript segments. Pure logic. */
export function detectLanguageFromText(text: string): 'zh' | 'en' | 'mixed' | 'unknown' {
  if (!text.trim()) return 'unknown';
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const ascii = (text.match(/[a-zA-Z]/g) || []).length;

  if (cjk === 0 && ascii === 0) return 'unknown';
  // Thresholds: if CJK is >30% of letters, it's Chinese-dominant; if CJK <5% and
  // ascii dominant, English; otherwise mixed.
  const total = cjk + ascii;
  const cjkRatio = cjk / total;

  if (cjkRatio > 0.3) return 'zh';
  if (cjkRatio < 0.05 && ascii > cjk) return 'en';
  if (cjk > 0 && ascii > 0) return 'mixed';
  return cjk > ascii ? 'zh' : 'en';
}

/** Detect from the first N ms of a transcript (PRD: first 60s). Pure logic. */
export function detectLanguageFromSegments(
  segments: Array<{ startMs: number; endMs: number; text: string }>,
  windowMs = 60_000,
): 'zh' | 'en' | 'mixed' | 'unknown' {
  const head = segments
    .filter((s) => s.startMs < windowMs)
    .map((s) => s.text)
    .join(' ');
  return detectLanguageFromText(head);
}

/** Map a detected language to the PRD ASR route (R1 Paraformer / R2 Deepgram). */
export function routeForDetectedLanguage(
  detected: 'zh' | 'en' | 'mixed' | 'unknown',
): { provider: 'paraformer' | 'deepgram'; reason: string } {
  switch (detected) {
    case 'zh':
      return { provider: 'paraformer', reason: 'CJK-dominant transcript' };
    case 'en':
      return { provider: 'deepgram', reason: 'ASCII-dominant transcript' };
    case 'mixed':
      // Mixed → prefer Paraformer (handles 中英夹杂 better per PRD correction pass).
      return { provider: 'paraformer', reason: 'mixed CJK/ASCII, Paraformer handles 中英夹杂' };
    default:
      return { provider: 'deepgram', reason: 'undetectable, default to Deepgram' };
  }
}
