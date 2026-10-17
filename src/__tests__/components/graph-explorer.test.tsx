import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GraphExplorer from '@/components/visualization/GraphExplorer';
import type { Graph3DData } from '@/components/visualization/KnowledgeGraph3D';

vi.mock('@/components/visualization/KnowledgeGraph3D', () => ({
  CLUSTER_PALETTE: ['#123456'],
  default: ({ data, onSelectNode }: { data: Graph3DData; onSelectNode: (node: Graph3DData['nodes'][number] | null) => void }) => (
    <button onClick={() => onSelectNode({ id: data.nodes[0].id, kind: data.nodes[0].kind, label: data.nodes[0].label })}>选择3D节点</button>
  ),
}));

const node = {
  id: 'node', kind: 'claim_cluster', label: '测试观点',
  metadataJson: { conversationId: 'stale' },
  evidenceConversationId: 'actual', evidence: { turnId: 'turn-402', startMs: 402000, quote: '实际原话' },
};

describe('GraphExplorer reader evidence entry', () => {
  it('keeps the API evidence when the 3D renderer returns only a node identity', () => {
    render(<GraphExplorer corpusId="corpus" nodes={[node]} edges={[]} insights={null} />);
    fireEvent.click(screen.getByRole('button', { name: '选择3D节点' }));
    expect(screen.getByRole('link', { name: '进阅读器 →' })).toHaveAttribute('href', '/read/actual?turn=turn-402&t=402000');
  });

  it('uses the same exact evidence link in the accessible list view', () => {
    render(<GraphExplorer corpusId="corpus" nodes={[node]} edges={[]} insights={null} />);
    fireEvent.click(screen.getByRole('radio', { name: '列表' }));
    fireEvent.click(screen.getByRole('button', { name: '测试观点' }));
    expect(screen.getByRole('link', { name: '进阅读器 →' })).toHaveAttribute('href', '/read/actual?turn=turn-402&t=402000');
  });

  it('retains only an episode link when no original evidence is present', () => {
    render(<GraphExplorer corpusId="corpus" nodes={[{ ...node, evidence: null, evidenceConversationId: null }]} edges={[]} insights={null} />);
    fireEvent.click(screen.getByRole('button', { name: '选择3D节点' }));
    expect(screen.getByRole('link', { name: '进阅读器 →' })).toHaveAttribute('href', '/read/stale');
  });
});
