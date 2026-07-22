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
