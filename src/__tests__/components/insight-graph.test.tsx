import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import InsightGraph, { type InsightGraphData } from '@/components/visualization/InsightGraph';

const data: InsightGraphData = {
  nodes: [
    { id: 'n1', kind: 'claim_cluster', label: 'AI is useful', canonicalText: 'AI is useful' },
    { id: 'n2', kind: 'entity', label: 'OpenAI', canonicalText: 'OpenAI' },
  ],
  edges: [
    { id: 'e1', relation: 'contradicts', confidence: 0.8, sourceNode: { id: 'n1', label: 'A', kind: 'claim_cluster' }, targetNode: { id: 'n2', label: 'B', kind: 'entity' } },
  ],
  layout: { n1: { x: 0, y: 0 }, n2: { x: 1, y: 1 } },
  insights: {
    clusters: [{ id: 0, label: 'AI', topNodeIds: ['n1'], size: 2 }],
    bridges: [{ nodeId: 'n1', betweenness: 0.5 }],
    structuralGaps: [{ clusterA: 0, clusterB: 1 }],
    controversies: [{ nodeId: 'n1', contradictCount: 1 }],
  },
};

describe('InsightGraph (V2/T-V2-7)', () => {
  it('renders the insight panel sections with data', () => {
    render(<InsightGraph corpusId="c1" data={data} />);
    expect(screen.getByText('主题聚类')).toBeInTheDocument();
    expect(screen.getByText('AI')).toBeInTheDocument();
    expect(screen.getByText('结构洞')).toBeInTheDocument();
    expect(screen.getByText('争议点')).toBeInTheDocument();
  });

  it('switches to the list view and lists nodes', () => {
    render(<InsightGraph corpusId="c1" data={data} />);
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    expect(screen.getByText('AI is useful')).toBeInTheDocument();
    expect(screen.getByText('OpenAI')).toBeInTheDocument();
  });

  it('shows an empty-state when there are no nodes', () => {
    render(<InsightGraph corpusId="c1" data={{ nodes: [], edges: [] }} />);
    // Empty state branch returns early with the no-data copy.
    expect(screen.getByText('Not enough structured data yet')).toBeInTheDocument();
  });
});
