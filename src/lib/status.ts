/**
 * One status vocabulary for the whole UI.
 *
 * Before this, the same conversation status was labelled three different ways
 * (dashboard STATUS_LABELS in Chinese, StatusBadge config in English uppercase,
 * SubmitBox STAGES with emoji) and the tone colors disagreed. Everything that
 * renders a status now reads from here.
 */

export type StatusTone = 'ready' | 'working' | 'queued' | 'failed';

export interface StatusView {
  tone: StatusTone;
  /** Chinese label — the product's primary language. */
  label: string;
  /** English label for the en locale. */
  labelEn: string;
}

const READY: StatusView = { tone: 'ready', label: '可读', labelEn: 'Ready' };
const WORKING: StatusView = { tone: 'working', label: '处理中', labelEn: 'Processing' };
const QUEUED: StatusView = { tone: 'queued', label: '排队中', labelEn: 'Queued' };
const FAILED: StatusView = { tone: 'failed', label: '失败', labelEn: 'Failed' };

const BY_STATUS: Record<string, StatusView> = {
  pending: QUEUED,
  queued: QUEUED,
  downloading: { tone: 'working', label: '下载中', labelEn: 'Downloading' },
  processing: { tone: 'working', label: '下载中', labelEn: 'Downloading' },
  transcribing: { tone: 'working', label: '转写中', labelEn: 'Transcribing' },
  diarizing: { tone: 'working', label: '整理说话人', labelEn: 'Separating speakers' },
  analyzing: { tone: 'working', label: '生成导读', labelEn: 'Summarizing' },
  extracting: { tone: 'working', label: '生成导读', labelEn: 'Summarizing' },
  transcribed: { tone: 'ready', label: '可读', labelEn: 'Ready' },
  completed: READY,
  ready: READY,
  failed: FAILED,
};

/** Badge classes per tone — semantic tokens, so dark mode follows automatically. */
export const TONE_CLASS: Record<StatusTone, string> = {
  ready: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  working: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  queued: 'bg-ink/5 text-ink-muted',
  failed: 'bg-red-500/10 text-red-700 dark:text-red-400',
};

/** Resolve any conversation/episode status string to its display view. */
export function statusView(status: string | null | undefined): StatusView {
  if (!status) return QUEUED;
  return BY_STATUS[status.toLowerCase()] ?? WORKING;
}

/** Convenience: the label in the given locale. */
export function statusLabel(status: string | null | undefined, lang: 'zh' | 'en' = 'zh'): string {
  const v = statusView(status);
  return lang === 'zh' ? v.label : v.labelEn;
}
