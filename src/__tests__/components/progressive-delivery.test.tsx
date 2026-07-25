import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ReaderShell, { type ReaderTurn } from '@/components/reader/ReaderShell';
import ProcessingPanel from '@/components/reader/ProcessingPanel';
import type { ProgressDetail } from '@/lib/reader/useProgressStream';

/**
 * PRD §3.3: the ~10 minute wait is delivered progressively inside the reader,
 * and the reader owns the SSE subscription so progress survives a refresh.
 */

const conversation = {
  id: 'conv_1',
  title: '测试单集',
  status: 'transcribing',
  ready: false,
  platform: 'xiaoyuzhou',
  platformLabel: '小宇宙',
  sourceUrl: null,
  coverUrl: null,
  showTitle: '测试节目',
  durationSec: 3600,
  readCount: null,
  audioUrl: null,
};

const turn = (id: string, turnIndex: number, text: string): ReaderTurn => ({
  id,
  turnIndex,
  startMs: turnIndex * 1000,
  endMs: (turnIndex + 1) * 1000,
  text,
  translationJson: null,
  participantName: '主播',
  participantLabel: 'speaker_0',
});

class MockEventSource {
  static instances: MockEventSource[] = [];
  readyState = 0;
  listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
  constructor(public url: string) {
    MockEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  close() {
    this.readyState = 2;
  }
}

const realEventSource = globalThis.EventSource;
const realFetch = globalThis.fetch;

beforeEach(() => {
  MockEventSource.instances = [];
  vi.stubGlobal('EventSource', MockEventSource);
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })));
});

afterEach(() => {
  // Restore only what this file stubbed — `unstubAllGlobals` would also wipe the
  // IntersectionObserver / matchMedia stubs installed once in __tests__/setup.ts.
  vi.stubGlobal('EventSource', realEventSource);
  vi.stubGlobal('fetch', realFetch);
});

describe('progressive delivery', () => {
  it('the reader opens its own progress stream when the episode is not ready', () => {
    render(
      <ReaderShell
        conversation={conversation}
        participants={[]}
        tldr={[]}
        quotes={[]}
        turns={[]}
        hasMoreTurns={false}
      />,
    );
    const streams = MockEventSource.instances.filter((e) => e.url.includes('/progress'));
    expect(streams).toHaveLength(1);
    expect(streams[0].url).toBe('/api/conversations/conv_1/progress');
  });

  it('does not open a stream once the episode is ready', () => {
    render(
      <ReaderShell
        conversation={{ ...conversation, status: 'completed', ready: true }}
        participants={[]}
        tldr={[]}
        quotes={[]}
        turns={[turn('t1', 0, '大家好')]}
        hasMoreTurns={false}
      />,
    );
    expect(MockEventSource.instances.filter((e) => e.url.includes('/progress'))).toHaveLength(0);
  });

  it('renders turns that arrive while still transcribing', () => {
    render(
      <ReaderShell
        conversation={conversation}
        participants={[]}
        tldr={[]}
        quotes={[]}
        turns={[turn('t1', 0, '第一段已经转好了')]}
        hasMoreTurns={false}
      />,
    );
    expect(screen.getByText('第一段已经转好了')).toBeInTheDocument();
  });

  it('de-duplicates a streamed turn against the same turn re-sent by the server', () => {
    // Same id in both slots must render once, not twice.
    const shared = turn('t1', 0, '重复段落');
    const { container } = render(
      <ReaderShell
        conversation={{ ...conversation, status: 'completed', ready: true }}
        participants={[]}
        tldr={[]}
        quotes={[]}
        turns={[shared, { ...shared, id: 't2', turnIndex: 1, text: '第二段' }]}
        hasMoreTurns={false}
      />,
    );
    expect(container.querySelectorAll('[data-turn-index]')).toHaveLength(1); // same speaker → one paragraph
    expect(screen.getAllByText('重复段落')).toHaveLength(1);
  });
});

describe('ProcessingPanel', () => {
  const detail: ProgressDetail = {
    stage: 'transcribing',
    label: '语音转写 42%',
    hint: '预计还需 3 分钟',
    progress: 0.42,
    elapsedMs: 125_000,
    etaMs: 180_000,
    turnCount: 87,
    thoughtUnitCount: 0,
  };

  it('shows real momentum, not just a spinner', () => {
    render(
      <ProcessingPanel
        detail={detail}
        stage="transcribing"
        stalled={false}
        fallbackProgress={0.45}
      />,
    );
    // Label is built from the catalogue + live percentage, never the
    // Chinese-only string the server puts in `detail.label`.
    expect(screen.getByText('语音转写 42%')).toBeInTheDocument();
    expect(screen.getByText('已转写 87 段')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '处理进度' })).toHaveAttribute(
      'aria-valuenow',
      '42',
    );
  });

  it('falls back to the server-rendered stage before the first SSE frame', () => {
    render(
      <ProcessingPanel detail={null} stage="downloading" stalled={false} fallbackProgress={0.2} />,
    );
    // Once as the headline, once in the stage rail — both are the same stage.
    expect(screen.getAllByText('下载音频')).toHaveLength(2);
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('下载音频');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '20');
  });

  it('says the stream dropped rather than freezing the bar', () => {
    render(
      <ProcessingPanel
        detail={detail}
        stage="transcribing"
        stalled
        fallbackProgress={0}
      />,
    );
    expect(screen.getByText('连接中断，正在重连…')).toBeInTheDocument();
  });

  it('offers a retry when the pipeline failed', () => {
    const onRetry = vi.fn();
    render(
      <ProcessingPanel
        detail={null}
        stage="failed"
        stalled={false}
        fallbackProgress={0}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText('处理失败')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新处理' })).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});
