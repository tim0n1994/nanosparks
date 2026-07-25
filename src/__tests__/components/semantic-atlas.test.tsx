import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SemanticAtlas from '@/components/visualization/SemanticAtlas';

const points = [
  { id: 'p1', embeddingId: 'e1', x: 0, y: 0, clusterId: 0, clusterLabel: null, text: 'AI is useful', type: 'claim', conversationId: 'c1' },
  { id: 'p2', embeddingId: 'e2', x: 5, y: 5, clusterId: 1, clusterLabel: null, text: 'Cooking pasta', type: 'insight', conversationId: 'c2' },
];

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ success: true, data: { points } }),
  })) as unknown as typeof fetch);
});

describe('SemanticAtlas (V2/T-V2-8)', () => {
  it('renders points and a cluster toggle', async () => {
    render(<SemanticAtlas corpusId="c1" />);
    await waitFor(() => expect(screen.getByTitle('AI is useful')).toBeInTheDocument());
    expect(screen.getByTitle('Cooking pasta')).toBeInTheDocument();
    // default color-by is cluster
    expect(screen.getByRole('button', { name: 'Cluster' })).toBeInTheDocument();
  });

  it('clicking a point opens an evidence card with a reader link', async () => {
    render(<SemanticAtlas corpusId="c1" />);
    const dot = await screen.findByTitle('AI is useful');
    fireEvent.click(dot);
    expect(screen.getByText('AI is useful')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: '进阅读器 →' });
    expect(link).toHaveAttribute('href', '/read/c1');
  });

  it('shows an empty state when there are no points', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ success: true, data: { points: [] } }) })) as unknown as typeof fetch);
    render(<SemanticAtlas corpusId="c1" />);
    await waitFor(() => expect(screen.getByText('还没有语义星图数据')).toBeInTheDocument());
  });
});
