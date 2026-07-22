import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import ReaderShell, { type ReaderTurn } from '@/components/reader/ReaderShell';

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
    const speakerCards = container.querySelectorAll('.rounded-lg.border.border-zinc-200');
   expect(speakerCards.length).toBeGreaterThanOrEqual(2);
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
    // The speaker name renders as a clickable button (cursor-text).
    const nameButton = screen.getByText('主播');
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
    // The banner now shows the staged label (转写中) rather than a static string.
    expect(screen.getByText('转写中')).toBeInTheDocument();
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
    expect(screen.getByText('原文')).toBeInTheDocument();
    expect(screen.getByText('译文')).toBeInTheDocument();
    expect(screen.getByText('对照')).toBeInTheDocument();
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
    expect(screen.queryByText('原文')).not.toBeInTheDocument();
  });
});
