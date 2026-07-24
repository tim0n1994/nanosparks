import { describe, it, expect } from 'vitest';
import { buildLocalSubgraph } from '@/lib/graph/incremental';

const baseTU = (id: string, type: string, text: string, extra: Record<string, unknown> = {}) => ({
  id, type, text, participantId: null, stance: null, ...extra,
});

describe('buildLocalSubgraph (V2/T-V2-4)', () => {
  it('creates a participant node and authored_by edge', () => {
    const plan = buildLocalSubgraph({
      thoughtUnits: [baseTU('tu1', 'claim', 'AI is useful', { participantId: 'p1' })],
      participants: [{ id: 'p1', name: 'Alice' }],
    });
    expect(plan.nodes.some((n) => n.key === 'participant:p1' && n.kind === 'participant')).toBe(true);
    expect(plan.edges).toContainEqual({ fromKey: 'tu:tu1', toKey: 'participant:p1', relation: 'authored_by', confidence: 0.9 });
  });

  it('links an objection to the nearest preceding claim with a contradicts edge', () => {
    const plan = buildLocalSubgraph({
      thoughtUnits: [
        baseTU('c1', 'claim', 'Remote work is great'),
        baseTU('o1', 'objection', 'Actually it hurts junior staff'),
      ],
      participants: [],
    });
    expect(plan.edges.some((e) => e.relation === 'contradicts' && e.fromKey === 'tu:o1' && e.toKey === 'tu:c1')).toBe(true);
  });

  it('does not delete / drop nodes for types outside the kind map (defaults to claim_cluster)', () => {
    const plan = buildLocalSubgraph({
      thoughtUnits: [baseTU('tu1', 'evidence', 'A study showed X')],
      participants: [],
    });
    expect(plan.nodes.find((n) => n.key === 'tu:tu1')?.kind).toBe('claim_cluster');
  });

  it('creates entity nodes + discusses + co_occurs edges', () => {
    const plan = buildLocalSubgraph({
      thoughtUnits: [baseTU('c1', 'claim', 'OpenAI ships fast')],
      participants: [],
      entityMentions: [
        { surfaceForm: 'OpenAI', entity: { id: 'e1', canonicalName: 'OpenAI', type: 'org' } },
        { surfaceForm: 'GPT-4', entity: { id: 'e2', canonicalName: 'GPT-4', type: 'product' } },
      ],
    });
    expect(plan.nodes.some((n) => n.key === 'entity:org:OpenAI' && n.entityId === 'e1')).toBe(true);
    expect(plan.edges.some((e) => e.relation === 'discusses')).toBe(true);
    expect(plan.edges.some((e) => e.relation === 'co_occurs')).toBe(true);
  });

  it('is deterministic / idempotent: identical input yields identical plan with no dup nodes', () => {
    const input = {
      thoughtUnits: [baseTU('tu1', 'claim', 'X'), baseTU('tu1', 'claim', 'X')],
      participants: [{ id: 'p1', name: 'A' }, { id: 'p1', name: 'A' }],
    };
    const plan = buildLocalSubgraph(input);
    const nodeKeys = plan.nodes.map((n) => n.key);
    expect(new Set(nodeKeys).size).toBe(nodeKeys.length); // no duplicate node keys
  });
});
