import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ClaimTimeline from '@/components/visualization/ClaimTimeline';

const entries = [
  { claimId: 'c1', text: '早期观点 A', assertedAt: '2026-03-01T00:00:00Z', conversationId: 'conv1', stance: 'assert' },
  { claimId: 'c2', text: '后期观点 B', assertedAt: '2026-01-01T00:00:00Z', conversationId: 'conv2', stance: 'oppose' },
];

describe('ClaimTimeline (V3/T-V3-1)', () => {
  it('sorts entries chronologically and renders reader links', () => {
    render(<ClaimTimeline entries={entries} />);
    const all = screen.getAllByText(/观点/);
    // earlier (B) rendered before later (A)
    expect(all[0]).toHaveTextContent('后期观点 B');
    expect(all[1]).toHaveTextContent('早期观点 A');
    expect(screen.getAllByRole('link', { name: '进阅读器 →' })).toHaveLength(2);
  });

  it('shows an empty hint when there are no entries', () => {
    render(<ClaimTimeline entries={[]} emptyHint="暂无数据" />);
    expect(screen.getByText('暂无数据')).toBeInTheDocument();
  });
});
