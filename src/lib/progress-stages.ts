/**
 * Staged progress labels (PRD §2.3 第一分钟/等待黑洞).
 *
 * The processing status (pending/processing/transcribing/completed/...) is
 * machine-facing. Users need human-language staged copy so the "first minute"
 * and "wait hole" moments feel alive:
 *   下载中 → 转写中 → 整理说话人 → 生成导读 → 可读
 *
* This maps Conversation.status (and optional sub-step) to a stage label + hint,
 * used by the reader's processing banner and the SSE progress stream.
 */

export type ConversationStatus =
  | 'pending'
  | 'processing'
  | 'transcribing'
  | 'transcribed'
  | 'completed'
  | 'failed';

export interface ProgressStage {
  /** Stage key for the client to key transitions on. */
  stage: 'queued' | 'downloading' | 'transcribing' | 'diarizing' | 'extracting' | 'ready' | 'failed';
  /** Human label shown in the banner. */
  label: string;
  /** Secondary hint explaining what is happening. */
  hint: string;
  /** 0..1 progress estimate for the progress bar. */
  progress: number;
}

export interface ProgressDetail extends ProgressStage {
  /** Milliseconds since the conversation was created (the job's wall-clock age). */
  elapsedMs: number;
  /** Rough remaining-time estimate in ms, derived from stage + observed timing. */
  etaMs: number;
  /** Turn count written so far (0 until transcription produces turns). */
  turnCount: number;
  /** ThoughtUnit count extracted so far (0 until analysis runs). */
  thoughtUnitCount: number;
}

/**
 * Per-stage expected duration (ms). Tuned from the observed Qwen3-ASR run on a
 * ~76min / 100MB episode: download ~20s, transcribe ~4min, analyze ~2min.
 * Used to give the user a real ETA instead of an indeterminate spinner.
 */
const STAGE_DURATION_MS: Record<ProgressStage['stage'], number> = {
  queued: 5_000,
  downloading: 25_000,
  transcribing: 250_000, // ~4min for a long episode; scales with duration
  diarizing: 30_000,
  extracting: 120_000, // ~2min for windowed extraction over ~16 windows
  ready: 0,
  failed: 0,
};

/**
 * Compute a rich progress snapshot for a conversation, including timing.
 * `createdAt` anchors elapsed time; turn/thoughtUnit counts come from the caller.
 */
export function getProgressDetail(
  status: string,
  createdAt: Date,
  subStep?: string,
  counts?: { turnCount?: number; thoughtUnitCount?: number },
): ProgressDetail {
  const stage = statusToStage(status, subStep);
  const elapsedMs = Math.max(0, Date.now() - new Date(createdAt).getTime());

  // ETA: remaining time in the *current* stage, assuming we just entered it.
  // This is intentionally rough — it gives users a sense of scale, not a promise.
  const expected = STAGE_DURATION_MS[stage.stage] ?? 60_000;
  const stageAge = elapsedMs % Math.max(expected, 1); // heuristic: where we are in the stage
  const etaMs = Math.max(0, expected - stageAge);

  return {
    ...stage,
    elapsedMs,
    etaMs,
    turnCount: counts?.turnCount ?? 0,
    thoughtUnitCount: counts?.thoughtUnitCount ?? 0,
  };
}

/**
 * Map a Conversation status to a staged progress label.
 * `subStep` lets the worker refine within "processing" (e.g. diarize vs extract).
 */
export function statusToStage(status: string, subStep?: string): ProgressStage {
  const s = (status || 'pending').toLowerCase() as ConversationStatus;

  if (subStep) {
    const sub = subStep.toLowerCase();
    if (sub === 'diarize' || sub === 'normalize') {
      return { stage: 'diarizing', label: '整理说话人', hint: '正在识别谁在说话、合并段落', progress: 0.6 };
    }
    if (sub === 'extract') {
      return { stage: 'extracting', label: '生成导读', hint: '正在提炼要点与金句', progress: 0.8 };
    }
  }

  switch (s) {
    case 'pending':
      return { stage: 'queued', label: '排队中', hint: '已加入处理队列', progress: 0.05 };
    case 'processing':
      return { stage: 'downloading', label: '下载中', hint: '正在获取音频', progress: 0.2 };
    case 'transcribing':
      return { stage: 'transcribing', label: '转写中', hint: '正在把语音变成文字', progress: 0.45 };
    case 'transcribed':
      // Transcription done → reading opens immediately; brief/quotes fill in async.
      return { stage: 'ready', label: '可读', hint: '全文已就绪，导读与金句陆续补上', progress: 0.95 };
    case 'completed':
      return { stage: 'ready', label: '可读', hint: '处理完成', progress: 1 };
    case 'failed':
      return { stage: 'failed', label: '处理失败', hint: '请稍后重试或换一个链接', progress: 0 };
    default:
      return { stage: 'queued', label: '处理中', hint: '', progress: 0.1 };
  }
}

/** True when the conversation is far enough along to open reading (PRD: 转写完成即先读). */
export function isReadable(status: string): boolean {
  const s = (status || '').toLowerCase();
  return s === 'transcribed' || s === 'completed';
}
