'use client';

import { useEffect, useRef, useState } from 'react';

/** Shape emitted by GET /api/conversations/:id/progress (see lib/progress-stages). */
export interface ProgressDetail {
  stage: 'queued' | 'downloading' | 'transcribing' | 'diarizing' | 'extracting' | 'ready' | 'failed';
  label: string;
  hint: string;
  progress: number;
  elapsedMs: number;
  etaMs: number;
  turnCount: number;
  thoughtUnitCount: number;
}

export interface ProgressState {
  detail: ProgressDetail | null;
  stage: ProgressDetail['stage'] | null;
  /** True while the stream is down but the job is still assumed to be running. */
  stalled: boolean;
  /** Ticks once per second so callers can render a smooth elapsed timer. */
  tick: number;
}

/** Survives a refresh so a mid-processing reload resumes the stream. */
export const INFLIGHT_KEY = 'nanosparks:inflightConversation';

const RECONNECT_MS = 3000;

/**
 * Subscribe to the staged-progress SSE stream for one conversation.
 *
 * Extracted from SubmitBox so the reader page can run the same subscription:
 * progress must survive a refresh, a backgrounded tab, or arriving at
 * /read/[id] directly from a link — not just live inside the submit form.
 *
 * Pass `null` to disable. `onReady` fires once when the pipeline completes.
 */
export function useProgressStream(
  conversationId: string | null,
  onReady?: () => void,
): ProgressState {
  const [detail, setDetail] = useState<ProgressDetail | null>(null);
  const [stage, setStage] = useState<ProgressDetail['stage'] | null>(null);
  const [stalled, setStalled] = useState(false);
  const [tick, setTick] = useState(0);
  // Kept in a ref so a changing callback identity does not tear down the stream.
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let es: EventSource | null = null;

    const apply = (d: ProgressDetail) => {
      if (cancelled) return;
      setStalled(false);
      setDetail(d);
      setStage(d.stage);
      if (d.stage === 'ready') {
        es?.close();
        sessionStorage.removeItem(INFLIGHT_KEY);
        onReadyRef.current?.();
      } else if (d.stage === 'failed') {
        es?.close();
        sessionStorage.removeItem(INFLIGHT_KEY);
      }
    };

    const connect = () => {
      if (cancelled) return;
      es = new EventSource(`/api/conversations/${conversationId}/progress`);
      const handle = (e: Event) => {
        try {
          apply(JSON.parse((e as MessageEvent).data) as ProgressDetail);
        } catch {
          /* malformed frame — the next heartbeat will correct it */
        }
      };
      es.addEventListener('stage', handle);
      es.addEventListener('tick', handle);
      es.addEventListener('error', () => {
        if (cancelled || !es || es.readyState !== EventSource.CLOSED) return;
        // The worker keeps running server-side; only the stream dropped.
        // Say so and reconnect rather than freezing the progress bar.
        setStalled(true);
        retry = setTimeout(connect, RECONNECT_MS);
      });
    };
    connect();

    const timer = setInterval(() => setTick((n) => n + 1), 1000);

    return () => {
      cancelled = true;
      clearInterval(timer);
      if (retry) clearTimeout(retry);
      es?.close();
    };
  }, [conversationId]);

  return { detail, stage, stalled, tick };
}
