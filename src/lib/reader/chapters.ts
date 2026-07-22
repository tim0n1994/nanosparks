/**
 * Chapter derivation (PRD §A3 章节导航 + 按章节懒加载).
 *
 * A 2h episode has ~600-1000 turns. The reader needs scrollable chapter anchors
 * so users can jump. We derive chapters from topic GraphNodes (each topic's
 * earliest ThoughtUnit evidence timestamp anchors it) plus fixed time-window
 * fallbacks when no topic data exists. Pure logic — tested in isolation.
 */

export interface ChapterAnchor {
  /** Stable id for React keys + scroll targeting. */
  id: string;
  /** Display label (topic label or time-window title). */
  label: string;
  /** First turn index in this chapter (for scroll-to + lazy-load gating). */
  turnIndex: number;
  /** Start time in ms. */
  startMs: number;
}

export interface TopicSignal {
  label: string;
  /** ms timestamp where this topic is first discussed. */
  startMs: number;
  /** Turn index at that timestamp. */
  turnIndex?: number;
}

export interface TurnForChapters {
  turnIndex: number;
  startMs: number;
}

/** Target chapter count for a long episode (PRD implies ~6-12 sections). */
const TARGET_CHAPTERS = 8;
const MIN_CHAPTER_GAP_MS = 2 * 60 * 1000; // 2 min — avoid micro-chapters

/**
 * Derive chapters from topic signals. Each distinct topic startMs becomes a
 * chapter boundary (deduped + sorted + min-gap-enforced).
 */
export function chaptersFromTopics(topics: TopicSignal[]): ChapterAnchor[] {
  if (topics.length === 0) return [];
  const sorted = [...topics]
    .filter((t) => t.startMs >= 0)
    .sort((a, b) => a.startMs - b.startMs);

  const out: ChapterAnchor[] = [];
  for (const t of sorted) {
    const prev = out[out.length - 1];
    if (prev && t.startMs - prev.startMs < MIN_CHAPTER_GAP_MS) continue; // too close
    out.push({
      id: `ch_${out.length}_${t.startMs}`,
      label: t.label,
      turnIndex: t.turnIndex ?? 0,
      startMs: t.startMs,
    });
  }
  return out;
}

/**
 * Fallback: derive chapters from fixed time windows over the turns.
 * Produces up to TARGET_CHAPTERS evenly-spaced boundaries.
 */
export function chaptersFromTimeWindows(turns: TurnForChapters[]): ChapterAnchor[] {
  if (turns.length === 0) return [];
  const sorted = [...turns].sort((a, b) => a.startMs - b.startMs);
  const first = sorted[0].startMs;
  const last = sorted[sorted.length - 1].startMs;
  const span = Math.max(1, last - first);
  const windowMs = span / TARGET_CHAPTERS;

  const out: ChapterAnchor[] = [];
  for (let i = 0; i < TARGET_CHAPTERS; i++) {
    const targetMs = first + windowMs * i;
    // Find the first turn at or after the target time.
    const turn = sorted.find((t) => t.startMs >= targetMs) ?? sorted[sorted.length - 1];
    const prev = out[out.length - 1];
    if (prev && turn.turnIndex <= prev.turnIndex) continue;
    out.push({
      id: `chw_${i}`,
      label: formatTimestampLabel(targetMs),
      turnIndex: turn.turnIndex,
      startMs: turn.startMs,
    });
  }
  return out;
}

/** Pick the best chapter set: topics if available, else time windows. */
export function deriveChapters(topics: TopicSignal[], turns: TurnForChapters[]): ChapterAnchor[] {
  const topicChapters = chaptersFromTopics(topics);
  if (topicChapters.length >= 2) return topicChapters;
  return chaptersFromTimeWindows(turns);
}

/** Format ms as a readable section label: "12:30" or "1:02:30". */
function formatTimestampLabel(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

/** Find the chapter id whose turnIndex is the largest <= a given turn index (for active highlight). */
export function activeChapterId(chapters: ChapterAnchor[], turnIndex: number): string | null {
  let active: ChapterAnchor | null = null;
  for (const c of chapters) {
    if (c.turnIndex <= turnIndex) active = c;
    else break;
  }
  return active?.id ?? null;
}
