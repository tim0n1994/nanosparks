import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ReaderStructurePanel from '@/components/reader/ReaderStructurePanel';
import type { ReaderParticipant, ReaderTurn } from '@/components/reader/ReaderShell';

const participants: ReaderParticipant[] = [
  { id: 'p1', name: '主播', speakerLabel: 'speaker_0', role: null },
  { id: 'p2', name: '嘉宾', speakerLabel: 'speaker_1', role: null },
];

const turns: ReaderTurn[] = [
  { id: 't1', turnIndex: 0, startMs: 0, endMs: 30000, text: '开场', translationJson: null, participantId: 'p1', participantName: '主播', participantLabel: 'speaker_0' },
  { id: 't2', turnIndex: 1, startMs: 30000, endMs: 900000, text: '嘉宾发言', translationJson: null, participantId: 'p2', participantName: '嘉宾', participantLabel: 'speaker_1' },
];

const thoughtUnits = [
  { id: 'tu1', type: 'claim', text: '播客是知识媒介', stance: 'assert', participantId: 'p1', startMs: 5000, endMs: 8000, turnId: 't1' },
  { id: 'tu2', type: 'objection', text: '未必，很多是娱乐', stance: 'oppose', participantId: 'p2', startMs: 60000, endMs: 65000, turnId: 't2' },
];

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ success: true, data: thoughtUnits }),
  })) as unknown as typeof fetch);
});

describe('ReaderStructurePanel (V1/T-V1-3)', () => {
  it('expands and renders speaker swimlanes from turns', async () => {
    const onSeek = vi.fn();
    render(
      <ReaderStructurePanel
        conversationId="c1"
        participants={participants}
        turns={turns}
        durationMs={900000}
        onSeek={onSeek}
      />,
    );

    // Collapsed by default.
    const toggle = screen.getByRole('button', { expanded: false });
    fireEvent.click(toggle);

    // Lanes are the default tab; clicking a turn block seeks the player.
    const block = await screen.findByTitle('主播 · 0:00');
    fireEvent.click(block);
    expect(onSeek).toHaveBeenCalledWith(0);
  });

  it('argument tree shows claims and is seek-linked', async () => {
    const onSeek = vi.fn();
    render(
      <ReaderStructurePanel
        conversationId="c1"
        participants={participants}
        turns={turns}
        durationMs={900000}
        onSeek={onSeek}
      />,
    );

    fireEvent.click(screen.getByRole('button', { expanded: false }));

    // Switch to the Arguments tab.
    const argsTab = await screen.findByRole('button', { name: /论点|Arguments/ });
    fireEvent.click(argsTab);

    await waitFor(() => {
      expect(screen.getByText('播客是知识媒介')).toBeInTheDocument();
    });

    // The opposition should appear nested under the claim (within 5 min window).
    expect(screen.getByText('未必，很多是娱乐')).toBeInTheDocument();
  });

  it('seeks to the claim timestamp when its card is clicked', async () => {
    const onSeek = vi.fn();
    render(
      <ReaderStructurePanel
        conversationId="c1"
        participants={participants}
        turns={turns}
        durationMs={900000}
        onSeek={onSeek}
      />,
    );

    fireEvent.click(screen.getByRole('button', { expanded: false }));
    fireEvent.click(await screen.findByRole('button', { name: /论点|Arguments/ }));

    await waitFor(() => expect(screen.getByText('播客是知识媒介')).toBeInTheDocument());
    fireEvent.click(screen.getByText('播客是知识媒介'));
    expect(onSeek).toHaveBeenCalledWith(5000);
  });
});
