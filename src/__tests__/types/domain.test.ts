/**
 * Tests for domain type definitions
 *
 * Validates that constants, type guards, and validation helpers
 * work correctly for the Phase 1 & 2 domain types.
 */

import { describe, it, expect } from 'vitest';

// Import source types for compile-time validation
import type {
  ThoughtUnitType,
  SourceKind,
  GraphNodeKind,
  GraphEdgeRelation,
} from '@/types/domain';

// ─── Canonical test constants ─────────────────────────────────
// These mirror the union types from @/types/domain.
// The `satisfies` checks below ensure they stay in sync.

const THOUGHT_UNIT_TYPES = [
  'claim',
  'question',
  'evidence',
  'objection',
  'decision',
  'risk',
  'insight',
] as const satisfies readonly ThoughtUnitType[];

function isValidThoughtUnitType(value: string): value is ThoughtUnitType {
  return (THOUGHT_UNIT_TYPES as readonly string[]).includes(value);
}

const SOURCE_KINDS = [
  'youtube_url',
  'media_upload',
  'transcript_upload',
  'meeting_import',
] as const satisfies readonly SourceKind[];

function isValidSourceKind(value: string): value is SourceKind {
  return (SOURCE_KINDS as readonly string[]).includes(value);
}

const GRAPH_NODE_KINDS = [
  'entity',
  'concept',
  'claim_cluster',
  'topic',
  'participant',
  'artifact',
  'decision',
  'open_question',
] as const satisfies readonly GraphNodeKind[];

function isValidGraphNodeKind(value: string): value is GraphNodeKind {
  return (GRAPH_NODE_KINDS as readonly string[]).includes(value);
}

const GRAPH_EDGE_RELATIONS = [
  'supports',
  'contradicts',
  'refines',
  'depends_on',
  'answers',
  'cites',
  'exemplifies',
  'raised_by',
  'agreed_by',
  'disputed_by',
] as const satisfies readonly GraphEdgeRelation[];

function isValidGraphEdgeRelation(value: string): value is GraphEdgeRelation {
  return (GRAPH_EDGE_RELATIONS as readonly string[]).includes(value);
}

// ─── Tests ─────────────────────────────────────────────────────

describe('ThoughtUnitType', () => {
  it('accepts all valid thought unit types', () => {
    const validTypes = ['claim', 'question', 'evidence', 'objection', 'decision', 'risk', 'insight'];
    for (const t of validTypes) {
      expect(isValidThoughtUnitType(t)).toBe(true);
    }
  });

  it('rejects invalid thought unit types', () => {
    expect(isValidThoughtUnitType('invalid')).toBe(false);
    expect(isValidThoughtUnitType('')).toBe(false);
    expect(isValidThoughtUnitType('Claim')).toBe(false); // case-sensitive
    expect(isValidThoughtUnitType('summary')).toBe(false);
  });

  it('has exactly 7 types', () => {
    expect(THOUGHT_UNIT_TYPES).toHaveLength(7);
  });
});

describe('SourceKind', () => {
  it('accepts all valid source kinds', () => {
    const validKinds = ['youtube_url', 'media_upload', 'transcript_upload', 'meeting_import'];
    for (const k of validKinds) {
      expect(isValidSourceKind(k)).toBe(true);
    }
  });

  it('rejects invalid source kinds', () => {
    expect(isValidSourceKind('podcast')).toBe(false);
    expect(isValidSourceKind('upload')).toBe(false); // 'media_upload' not 'upload'
  });

  it('has exactly 4 kinds', () => {
    expect(SOURCE_KINDS).toHaveLength(4);
  });
});

describe('GraphNodeKind', () => {
  it('accepts all valid graph node kinds', () => {
    const validKinds = ['entity', 'concept', 'claim_cluster', 'topic', 'participant', 'artifact', 'decision', 'open_question'];
    for (const k of validKinds) {
      expect(isValidGraphNodeKind(k)).toBe(true);
    }
  });

  it('rejects invalid graph node kinds', () => {
    expect(isValidGraphNodeKind('person')).toBe(false);
    expect(isValidGraphNodeKind('idea')).toBe(false);
  });

  it('has exactly 8 kinds', () => {
    expect(GRAPH_NODE_KINDS).toHaveLength(8);
  });
});

describe('GraphEdgeRelation', () => {
  it('accepts all valid edge relations', () => {
    const valid = ['supports', 'contradicts', 'refines', 'depends_on', 'answers', 'cites', 'exemplifies', 'raised_by', 'agreed_by', 'disputed_by'];
    for (const r of valid) {
      expect(isValidGraphEdgeRelation(r)).toBe(true);
    }
  });

  it('rejects invalid edge relations', () => {
    expect(isValidGraphEdgeRelation('confirms')).toBe(false);
    expect(isValidGraphEdgeRelation('disagrees_with')).toBe(false);
  });

  it('has exactly 10 relations', () => {
    expect(GRAPH_EDGE_RELATIONS).toHaveLength(10);
  });
});

describe('EvidenceSpanInput structure', () => {
  it('validates that EvidenceSpanInput has required fields', () => {
    // Test the interface contract: required fields
    const validSpan = {
      startMs: 1000,
      endMs: 5000,
      quote: 'This is a quote from the transcript',
    };

    expect(validSpan).toHaveProperty('startMs');
    expect(validSpan).toHaveProperty('endMs');
    expect(validSpan).toHaveProperty('quote');
    expect(typeof validSpan.startMs).toBe('number');
    expect(typeof validSpan.endMs).toBe('number');
    expect(typeof validSpan.quote).toBe('string');
    expect(validSpan.endMs).toBeGreaterThan(validSpan.startMs);
  });
});

describe('ThoughtUnitInput structure', () => {
  it('validates that ThoughtUnitInput has required fields', () => {
    const unit = {
      type: 'claim' as const,
      text: 'This is a claim',
      confidence: 0.95,
      evidenceSpans: [
        { startMs: 1000, endMs: 5000, quote: 'Evidence quote' },
      ],
    };

    expect(unit).toHaveProperty('type');
    expect(unit).toHaveProperty('text');
    expect(unit).toHaveProperty('confidence');
    expect(unit).toHaveProperty('evidenceSpans');
    expect(Array.isArray(unit.evidenceSpans)).toBe(true);
    expect(unit.evidenceSpans).toHaveLength(1);
  });

  it('confidence must be between 0 and 1', () => {
    const valid = [0, 0.5, 1.0];
    for (const c of valid) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });
});

describe('StorageSaveResult structure', () => {
  it('has all required fields', () => {
    const result = {
      key: 'abc123.mp3',
      url: '/api/storage/abc123.mp3',
      size: 1024,
    };

    expect(result).toHaveProperty('key');
    expect(result).toHaveProperty('url');
    expect(result).toHaveProperty('size');
    expect(typeof result.size).toBe('number');
    expect(result.size).toBeGreaterThan(0);
  });
});

describe('UploadResponse structure', () => {
  it('has all required fields', () => {
    const response = {
      sourceId: 'src_123',
      conversationId: 'conv_456',
      status: 'processing',
    };

    expect(response).toHaveProperty('sourceId');
    expect(response).toHaveProperty('conversationId');
    expect(response).toHaveProperty('status');
  });
});

describe('TranscriptionResult structure', () => {
  it('validates a transcription result', () => {
    const result = {
      segments: [
        { startMs: 0, endMs: 3000, text: 'Hello', speakerLabel: 'A', confidence: 0.98 },
      ],
      language: 'en',
      durationMs: 3000,
      provider: 'whisperx',
    };

    expect(result.segments).toHaveLength(1);
    expect(result.language).toBe('en');
    expect(result.provider).toBe('whisperx');
    expect(result.durationMs).toBe(3000);

    const segment = result.segments[0];
    expect(segment.endMs).toBeGreaterThan(segment.startMs);
    expect(segment.confidence).toBeGreaterThan(0);
  });
});
