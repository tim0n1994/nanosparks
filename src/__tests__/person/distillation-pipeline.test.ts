import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  turns: vi.fn(), conversation: vi.fn(), thoughtUnits: vi.fn(), updateThought: vi.fn(),
  identities: vi.fn(), merge: vi.fn(), promote: vi.fn(), fingerprint: vi.fn(), host: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: {
  turn: { findMany: mocks.turns }, conversation: { findUnique: mocks.conversation },
  thoughtUnit: { findMany: mocks.thoughtUnits, update: mocks.updateThought },
} }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/person/identity-resolver', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/person/identity-resolver')>(), resolveConversationIdentities: mocks.identities,
}));
vi.mock('@/lib/person/merge-speakers', () => ({ mergeSpeakersForConversation: mocks.merge }));
vi.mock('@/lib/person/claim-promoter', () => ({ promotePersonClaims: mocks.promote }));
vi.mock('@/lib/person/fingerprint-builder', () => ({ buildPersonFingerprint: mocks.fingerprint }));
vi.mock('@/lib/person/host-fingerprint', () => ({ buildHostFingerprint: mocks.host }));

import { attributeThoughtUnitsViaEvidence, runDistillationForConversation } from '@/lib/person/distillation-pipeline';

const evidence = (id: string, name: string) => ({ turn: { participantId: id, participant: { name } } });

describe('distillation preserves completed speaker assignments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.turns.mockResolvedValue([{ endMs: 1000, participantId: 'marc', attributionMethod: 'llm', attributionConfidence: 0.9, text: 'Source text', rawText: null }]);
    mocks.conversation.mockResolvedValue({ globalEpisode: { durationSec: 1 } });
    mocks.identities.mockResolvedValue({ entities: ['entity'], linked: 1 });
    mocks.thoughtUnits.mockResolvedValue([]);
    mocks.updateThought.mockResolvedValue({});
    mocks.merge.mockResolvedValue({});
    mocks.promote.mockResolvedValue({});
    mocks.fingerprint.mockResolvedValue({});
    mocks.host.mockResolvedValue({});
  });

  it('skips legacy merge when assignments are complete but continues evidence attribution and person stages', async () => {
    await runDistillationForConversation('conversation', { speakerAssignmentsComplete: true });
    expect(mocks.merge).not.toHaveBeenCalled();
    expect(mocks.thoughtUnits).toHaveBeenCalled();
    expect(mocks.promote).toHaveBeenCalledWith('entity');
    expect(mocks.fingerprint).toHaveBeenCalledWith('entity');
    expect(mocks.host).toHaveBeenCalledWith('entity');
  });

  it('keeps legacy merge enabled by default', async () => {
    await runDistillationForConversation('conversation');
    expect(mocks.merge).toHaveBeenCalledTimes(1);
    expect(mocks.promote).toHaveBeenCalledWith('entity');
  });

  it('repairs an anonymous TU only when every evidence turn agrees on a named participant', async () => {
    mocks.thoughtUnits.mockResolvedValue([
      { id: 'anonymous', participantId: 'unknown', participant: { name: 'SPEAKER_UNKNOWN' }, evidenceSpans: [evidence('marc', 'Marc Andreessen'), evidence('marc', 'Marc Andreessen')] },
      { id: 'empty', participantId: null, participant: null, evidenceSpans: [evidence('marc', 'Marc Andreessen')] },
    ]);
    expect(await attributeThoughtUnitsViaEvidence('conversation')).toBe(2);
    expect(mocks.thoughtUnits.mock.calls[0][0].where).toEqual({ conversationId: 'conversation' });
    expect(mocks.thoughtUnits.mock.calls[0][0].select.evidenceSpans).not.toHaveProperty('take');
    expect(mocks.updateThought).toHaveBeenCalledWith({ where: { id: 'anonymous' }, data: { participantId: 'marc' } });
    expect(mocks.updateThought).toHaveBeenCalledWith({ where: { id: 'empty' }, data: { participantId: 'marc' } });
  });

  it('preserves already named, conflicting, missing and anonymous-evidence TUs', async () => {
    const source = { participantId: 'unknown', participant: { name: 'SPEAKER_UNKNOWN' } };
    mocks.thoughtUnits.mockResolvedValue([
      { id: 'named', participantId: 'lex', participant: { name: 'Lex Fridman' }, evidenceSpans: [evidence('marc', 'Marc Andreessen')] },
      { id: 'conflict', ...source, evidenceSpans: [evidence('marc', 'Marc Andreessen'), evidence('lex', 'Lex Fridman')] },
      { id: 'missing', ...source, evidenceSpans: [evidence('marc', 'Marc Andreessen'), { turn: null }] },
      { id: 'unknown', ...source, evidenceSpans: [evidence('unknown', 'SPEAKER_UNKNOWN')] },
      { id: 'no-evidence', ...source, evidenceSpans: [] },
    ]);
    expect(await attributeThoughtUnitsViaEvidence('conversation')).toBe(0);
    expect(mocks.updateThought).not.toHaveBeenCalled();
  });
});
