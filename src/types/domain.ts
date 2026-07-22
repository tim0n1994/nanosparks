/**
 * Phase 1 & 2 Domain Types
 *
 * New domain model types for the conversation intelligence architecture.
 * Separate from src/types/analysis.ts (legacy YouTube-focused types).
 */

// ─── Thought Units ────────────────────────────────────────────

export type ThoughtUnitType =
  | 'claim'
  | 'question'
  | 'evidence'
  | 'objection'
  | 'decision'
  | 'risk'
  | 'insight';

export interface EvidenceSpanInput {
  turnIndex?: number;
  turnId?: string;
  startMs: number;
  endMs: number;
  quote: string;
}

export interface ThoughtUnitInput {
  type: ThoughtUnitType;
  text: string;
  confidence: number;
  evidenceSpans: EvidenceSpanInput[];
}

export interface LLMThoughtUnitOutput {
  thoughtUnits: ThoughtUnitInput[];
}

// ─── Transcription ────────────────────────────────────────────

/** Word-level timestamp from ASR, for precise evidence highlighting */
export interface WordTimestamp {
  word: string;
  startMs: number;
  endMs: number;
  confidence?: number;
}

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
  speakerLabel?: string;
  confidence?: number;
  /** Word-level timestamps from ASR (when available) */
  words?: WordTimestamp[];
}

export interface TranscriptionResult {
  segments: TranscriptSegment[];
  language?: string;
  durationMs?: number;
  provider: string;
  /** Estimated ASR cost in USD (PRD §A2 成本打点). Populated by providers that bill. */
  costUsd?: number;
}

// ─── Diarization ──────────────────────────────────────────────

/** A speaker segment from diarization (who spoke when) */
export interface SpeakerSegment {
  /** Anonymous label, e.g. "SPEAKER_00" */
  label: string;
  startMs: number;
  endMs: number;
  confidence?: number;
}

export interface DiarizationResult {
  segments: SpeakerSegment[];
  /** Number of distinct speakers detected */
  speakerCount: number;
  provider: string;
}

/**
 * A normalized turn: continuous speech by a single speaker.
 * Produced by merging ASR word sequences with diarization speaker segments.
 */
export interface NormalizedTurn {
  speakerLabel: string;
  startMs: number;
  endMs: number;
  text: string;
  words?: WordTimestamp[];
  confidence: number;
}

// ─── Storage ──────────────────────────────────────────────────

export interface StorageSaveResult {
  key: string;
  url: string;
  size: number;
}

// ─── Source / Ingest ──────────────────────────────────────────

export type SourceKind =
  | 'youtube_url'
  | 'media_upload'
  | 'transcript_upload'
  | 'meeting_import';

export type SourceConsentStatus =
  | 'unknown'
  | 'granted'
  | 'denied'
  | 'public'
  | 'imported_by_owner';

export type SourceVisibility =
  | 'private'
  | 'workspace'
  | 'shared_link'
  | 'public';

export interface CreateSourceInput {
  kind: SourceKind;
  uri?: string;
  corpusId: string;
  consentStatus?: SourceConsentStatus;
  visibility?: SourceVisibility;
  retentionPolicy?: 'keep' | 'delete_after_processing';
  title?: string;
}

export interface UploadResponse {
  sourceId: string;
  conversationId: string;
  status: string;
}

// ─── Graph (Phase 3 placeholder) ──────────────────────────────

export type GraphNodeKind =
  | 'entity'
  | 'concept'
  | 'claim_cluster'
  | 'topic'
  | 'participant'
  | 'artifact'
  | 'decision'
  | 'open_question';

export type GraphEdgeRelation =
  | 'supports'
  | 'contradicts'
  | 'refines'
  | 'depends_on'
  | 'answers'
  | 'cites'
  | 'exemplifies'
  | 'raised_by'
  | 'agreed_by'
  | 'disputed_by';
