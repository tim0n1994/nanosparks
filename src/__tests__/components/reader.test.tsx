import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import ReaderShell, { type ReaderTurn } from '@/components/reader/ReaderShell';
import { ToastProvider } from '@/components/ui/Toast';

const navigation = vi.hoisted(() => ({ query: '' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(navigation.query),
}));
afterEach(() => { navigation.query = ''; vi.restoreAllMocks(); });

const baseConversation = {
  id: 'conv_1',
  title: '测试单集',
  status: 'completed',
  ready: true,
  language: 'zh',
  platform: 'xiaoyuzhou',
  platformLabel: '小宇宙',
  sourceUrl: 'https://example.com/ep',
  coverUrl: 'https://img.example.com/c.jpg',
  showTitle: '测试节目',
  durationSec: 3600,
  readCount: 5,
  audioUrl: 'https://cdn.example.com/ep.m4a',
};

const turns: ReaderTurn[] = [
  {
    id: 't1', turnIndex: 0, startMs: 1000, endMs: 2000, text: '大家好',
    translationJson: { en: 'Hello everyone' }, participantName: '主播', participantLabel: 'speaker_0',
  },
  {
    id: 't2', turnIndex: 1, startMs: 2000, endMs: 3000, text: '今天聊播客',
    translationJson: { en: "Today's topic is podcasts" }, participantName: '主播', participantLabel: 'speaker_0',
  },
  {
    id: 't3', turnIndex: 2, startMs: 3000, endMs: 4000, text: '欢迎嘉宾',
    translationJson: null, participantName: '嘉宾', participantLabel: 'speaker_1',
  },
];

describe('ReaderShell', () => {
  it('resumes at a saved turn beyond the initial page after loading its original text', async () => {
    const scroll = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll });
    const makeTurn = (index: number): ReaderTurn => ({ ...turns[0], id: `resume-${index}`, turnIndex: index, text: `正文 ${index}`, translationJson: null });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return { ok: true, json: async () => url.includes('/turns?')
        ? { success: true, data: Array.from({ length: 100 }, (_, i) => ({ ...makeTurn(i + 200), cleanText: `保存位置原话 ${i + 200}`, participant: { name: '主播', speakerLabel: 'speaker_0' } })), meta: { hasMore: false, count: 100, nextCursor: null } }
        : { success: true, progress: { turnIndex: 250, scrollRatio: 0.7, completedAt: null }, highlights: [] } };
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock as unknown as typeof fetch);
    render(<ToastProvider><ReaderShell conversation={{ ...baseConversation, audioUrl: null, sourceUrl: null }} participants={[]} tldr={[]} quotes={[]} turns={Array.from({ length: 200 }, (_, i) => makeTurn(i))} hasMoreTurns /></ToastProvider>);
    const resume = await screen.findByRole('button', { name: '继续阅读' });
    expect(document.getElementById('reader-turn-resume-0')?.closest('article')).toHaveClass('defer-paint');
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/turns?'))).toHaveLength(0);
    fireEvent.click(resume);
    await waitFor(() => expect(document.activeElement).toHaveAttribute('id', 'reader-turn-resume-250'));
    expect(document.activeElement).toHaveTextContent('保存位置原话 250');
    expect(document.activeElement?.closest('article')).not.toHaveClass('defer-paint');
    expect(scroll).toHaveBeenLastCalledWith({ behavior: 'instant', block: 'center' });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/turns?')).map(([url]) => url)).toEqual([
      '/api/conversations/conv_1/turns?limit=200&cursor=resume-199',
    ]);
  });

  it('reports a missing saved reading position after exhausting pages without focusing another turn', async () => {
    const scroll = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      json: async () => String(input).includes('/turns?')
        ? { success: true, data: [], meta: { hasMore: false } }
        : { success: true, progress: { turnIndex: 250, completedAt: null }, highlights: [] },
    }));
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock as unknown as typeof fetch);
    render(<ToastProvider><ReaderShell conversation={{ ...baseConversation, audioUrl: null, sourceUrl: null }} participants={[]} tldr={[]} quotes={[]} turns={turns} hasMoreTurns /></ToastProvider>);
    fireEvent.click(await screen.findByRole('button', { name: '继续阅读' }));
    expect(await screen.findByText('未找到这个阅读位置，当前显示整集内容。')).toBeInTheDocument();
    expect(scroll).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/turns?'))).toHaveLength(1);
  });

  it('locates the exact turn inside a grouped paragraph without an audio source', async () => {
    navigation.query = 'turn=t2&t=2000';
    const scroll = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll });
    render(<ReaderShell conversation={{ ...baseConversation, audioUrl: null, sourceUrl: null }} participants={[]} tldr={[]} quotes={[]} turns={turns} hasMoreTurns={false} />);
    await waitFor(() => expect(document.activeElement).toHaveAttribute('id', 'reader-turn-t2'));
    expect(document.activeElement).toHaveTextContent('今天聊播客');
    expect(scroll).toHaveBeenCalled();
  });

  it('loads successive pages until a linked turn beyond the initial 200 is present', async () => {
    navigation.query = 'turn=t402&t=402000';
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
    const makeTurn = (index: number): ReaderTurn => ({ ...turns[0], id: `t${index}`, turnIndex: index, startMs: index * 1000, endMs: (index + 1) * 1000, translationJson: null });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const page = url.includes('cursor=t199') ? Array.from({ length: 200 }, (_, i) => makeTurn(i + 200)) : [makeTurn(400), makeTurn(401), makeTurn(402)];
      return { ok: true, json: async () => url.includes('/turns?') ? { success: true, data: page.map(turn => ({ ...turn, cleanText: `原话 ${turn.turnIndex}`, participant: { id: 'speaker', name: '嘉宾', speakerLabel: 's1' } })), meta: { hasMore: page.length === 200 } } : { success: true, progress: null, highlights: [] } };
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock as unknown as typeof fetch);
    render(<ReaderShell conversation={{ ...baseConversation, audioUrl: null, sourceUrl: null }} participants={[]} tldr={[]} quotes={[]} turns={Array.from({ length: 200 }, (_, i) => makeTurn(i))} hasMoreTurns />);
    await waitFor(() => expect(document.activeElement).toHaveAttribute('id', 'reader-turn-t402'));
    expect(document.activeElement).toHaveTextContent('原话 402');
    expect(document.activeElement?.closest('article')).not.toHaveClass('defer-paint');
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'instant', block: 'center' });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/turns?')).map(([url]) => url)).toEqual([
      '/api/conversations/conv_1/turns?limit=200&cursor=t199',
      '/api/conversations/conv_1/turns?limit=200&cursor=t399',
    ]);
  });

  it('uses the next turn at an exact timestamp boundary without an ID', async () => {
    navigation.query = 't=2000';
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
    render(<ReaderShell conversation={{ ...baseConversation, audioUrl: null, sourceUrl: null }} participants={[]} tldr={[]} quotes={[]} turns={turns} hasMoreTurns={false} />);
    await waitFor(() => expect(document.activeElement).toHaveAttribute('id', 'reader-turn-t2'));
  });

  it('stops when a stale turn ID is absent instead of focusing an unrelated timestamp', async () => {
    navigation.query = 'turn=deleted&t=2000';
    const scroll = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll });
    render(<ReaderShell conversation={{ ...baseConversation, audioUrl: null, sourceUrl: null }} participants={[]} tldr={[]} quotes={[]} turns={turns} hasMoreTurns={false} />);
    expect(scroll).not.toHaveBeenCalled();
  });

  it('waits for audio metadata before seeking to the cited instant', () => {
    navigation.query = 'turn=t2&t=2500';
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
    const { container } = render(<ReaderShell conversation={baseConversation} participants={[]} tldr={[]} quotes={[]} turns={turns} hasMoreTurns={false} />);
    const audio = container.querySelector('audio')!;
    expect(audio.currentTime).toBe(0);
    fireEvent.loadedMetadata(audio);
    expect(audio.currentTime).toBe(2.5);
  });

  it('chapter navigation targets its turn inside a paragraph instead of the next speaker', () => {
    const scroll = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll });
    render(<ReaderShell conversation={baseConversation} chapters={[{ id: 'intro', label: '开头', turnIndex: 0, startMs: 1000 }, { id: 'chapter', label: '段内章节', turnIndex: 1, startMs: 2000 }]} participants={[]} tldr={[]} quotes={[]} turns={turns} hasMoreTurns={false} />);
    fireEvent.click(screen.getByRole('button', { name: '章节导航' }));
    fireEvent.click(screen.getByRole('button', { name: /段内章节/ }));
    expect(scroll.mock.contexts.at(-1)).toBe(document.getElementById('reader-turn-t2'));
  });

  it('renders hero with title, show, platform, read count, source link', () => {
    render(
      <ReaderShell
        conversation={baseConversation}
        participants={[]}
        tldr={[]}
        quotes={[]}
        turns={turns}
        hasMoreTurns={false}
      />,
    );
    expect(screen.getByText('测试单集')).toBeInTheDocument();
    expect(screen.getByText('测试节目')).toBeInTheDocument();
    expect(screen.getByText('小宇宙')).toBeInTheDocument();
    expect(screen.getByText('5 人读过')).toBeInTheDocument();
    expect(screen.getByText('原链接').closest('a')).toHaveAttribute('href', 'https://example.com/ep');
  });

  it('renders TL;DR points and 金句 wall', () => {
    render(
      <ReaderShell
        conversation={baseConversation}
        participants={[]}
        tldr={[{ id: 'tu1', type: 'insight', text: '核心结论 A' }]}
        quotes={[{ id: 'q1', text: '金句一', timestampMs: 1500 }]}
        turns={turns}
        hasMoreTurns={false}
      />,
    );
    expect(screen.getByText('核心结论 A')).toBeInTheDocument();
    expect(screen.getByText('金句一')).toBeInTheDocument();
  });

  it('groups consecutive same-speaker turns into one paragraph', () => {
    const { container } = render(
      <ReaderShell
        conversation={baseConversation}
        participants={[]}
        tldr={[]}
        quotes={[]}
        turns={turns}
        hasMoreTurns={false}
      />,
    );
    // speaker_0 (主播) gets one card with both lines; speaker_1 (嘉宾) gets another.
    const speakerCards = container.querySelectorAll('[data-turn-index]');
    expect(speakerCards.length).toBe(2);
    expect(speakerCards[0].textContent).toContain('大家好');
    expect(speakerCards[0].textContent).toContain('今天聊播客');
    expect(speakerCards[1].textContent).toContain('欢迎嘉宾');
  });

  it('shows an inline-editable speaker name (PRD §A3 改名)', () => {
    render(
      <ReaderShell
        conversation={baseConversation}
        participants={[]}
        tldr={[]}
        quotes={[]}
        turns={turns}
        hasMoreTurns={false}
      />,
    );
    // The speaker name renders as a clickable button.
    const nameButton = screen.getAllByText('主播')[0];
    expect(nameButton.tagName).toBe('BUTTON');

    // Click → becomes an input.
    fireEvent.click(nameButton);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('shows a processing banner when the conversation is not ready', () => {
    render(
      <ReaderShell
        conversation={{ ...baseConversation, status: 'transcribing', ready: false }}
        participants={[]}
        tldr={[]}
        quotes={[]}
        turns={[]}
        hasMoreTurns={false}
      />,
    );
    // The banner is live now: the stage name comes from the i18n catalogue
    // (so it translates), and the stage rail marks the current step.
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('语音转写');
    expect(screen.getByRole('progressbar', { name: '处理进度' })).toBeInTheDocument();
  });

  it('renders the bilingual toggle when translations exist', () => {
    render(
      <ReaderShell
        conversation={baseConversation}
        participants={[]}
        tldr={[]}
        quotes={[]}
        turns={turns}
        hasMoreTurns={false}
      />,
    );
   const group = screen.getByRole('radiogroup', { name: '双语显示' });
   expect(group).toBeInTheDocument();
    // When translations exist, ReaderShell defaults to the side-by-side view.
    expect(screen.getByRole('radio', { name: '对照' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: '原文' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '译文' })).toBeInTheDocument();
  });

  it('does not render the bilingual toggle when no translations exist', () => {
    render(
      <ReaderShell
        conversation={baseConversation}
        participants={[]}
        tldr={[]}
        quotes={[]}
        turns={turns.map((t) => ({ ...t, translationJson: null }))}
        hasMoreTurns={false}
      />,
    );
    expect(screen.queryByRole('radiogroup', { name: '双语显示' })).not.toBeInTheDocument();
  });
});
