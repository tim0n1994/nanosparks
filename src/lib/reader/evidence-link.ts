export interface ReaderEvidence {
  turnId?: string | null;
  startMs: number;
  quote?: string;
}

export function readerEvidenceLink(conversationId: string, evidence?: ReaderEvidence | null): string {
  const path = `/read/${encodeURIComponent(conversationId)}`;
  if (!evidence || !Number.isSafeInteger(evidence.startMs) || evidence.startMs < 0) return path;
  const query = new URLSearchParams();
  if (evidence.turnId) query.set('turn', evidence.turnId);
  query.set('t', String(evidence.startMs));
  return `${path}?${query}`;
}

export function parseReaderAnchor(query: Pick<URLSearchParams, 'get'>): { turnId: string | null; startMs: number | null } | null {
  const turnId = query.get('turn')?.trim() || null;
  const value = query.get('t');
  const numeric = value !== null && /^\d+$/.test(value) ? Number(value) : NaN;
  const startMs = Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : null;
  return turnId || startMs !== null ? { turnId, startMs } : null;
}
