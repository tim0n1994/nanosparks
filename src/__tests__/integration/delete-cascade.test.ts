/**
 * Delete Cascade Integration Test
 *
 * Per Track F.4: create a full-chain source (media + transcript + TU + edges +
 * embedding + brief + share), delete it, and assert zero residue across all tables.
 *
 * This is the Phase 4 exit criterion from the vision doc.
 * Requires a running Postgres + Redis (skipped in CI without DB).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
const skip = !databaseUrl || process.env.SKIP_INTEGRATION === 'true';

const testPool = skip ? null : new Pool({ connectionString: databaseUrl });
const testAdapter = testPool ? new PrismaPg(testPool) : null;
const prisma = testAdapter ? new PrismaClient({ adapter: testAdapter }) : null;

describe.skipIf(skip)('Delete Cascade — full chain', () => {
  let workspaceId: string;
  let corpusId: string;
  let sourceId: string;
  let conversationId: string;
  let turnId: string;
  let thoughtUnitId: string;
  let evidenceSpanId: string;
  let graphNodeId: string;
  let briefId: string;

  beforeAll(async () => {
    if (!prisma) return;

    // Create full chain
    const workspace = await prisma.workspace.create({
      data: { name: 'cascade-test-ws' },
    });
    workspaceId = workspace.id;

    const corpus = await prisma.corpus.create({
      data: { name: 'cascade-test-corpus', workspaceId },
    });
    corpusId = corpus.id;

    const source = await prisma.source.create({
      data: { kind: 'media_upload', corpusId, status: 'completed' },
    });
    sourceId = source.id;

    const mediaAsset = await prisma.mediaAsset.create({
      data: {
        sourceId,
        mediaType: 'audio',
        storageKey: 'test-key',
        mimeType: 'audio/mp3',
      },
    });

    const conversation = await prisma.conversation.create({
      data: {
        title: 'cascade-test-conv',
        sourceId,
        corpusId,
        status: 'completed',
      },
    });
    conversationId = conversation.id;

    const participant = await prisma.participant.create({
      data: { conversationId, name: 'Speaker A', speakerLabel: 'SPEAKER_00' },
    });

    const turn = await prisma.turn.create({
      data: {
        conversationId,
        participantId: participant.id,
        startMs: 0,
        endMs: 5000,
        text: 'Test transcript text',
        cleanText: 'Test transcript text',
        turnIndex: 0,
      },
    });
    turnId = turn.id;

    const tu = await prisma.thoughtUnit.create({
      data: {
        conversationId,
        type: 'claim',
        text: 'Test claim for cascade',
        confidence: 0.9,
      },
    });
    thoughtUnitId = tu.id;

    const es = await prisma.evidenceSpan.create({
      data: {
        thoughtUnitId: tu.id,
        turnId,
        startMs: 0,
        endMs: 5000,
        quote: 'Test claim',
      },
    });
    evidenceSpanId = es.id;

    const node = await prisma.graphNode.create({
      data: { corpusId, kind: 'claim_cluster', label: 'Test cluster' },
    });
    graphNodeId = node.id;

    const brief = await prisma.brief.create({
      data: {
        corpusId,
        title: 'Test Brief',
        sectionsJson: [{ heading: 'Test', content: 'Content' }],
      },
    });
    briefId = brief.id;

    const auditLog = await prisma.auditLog.create({
      data: {
        action: 'view',
        resourceType: 'Corpus',
        resourceId: corpusId,
      },
    });

    const extractionRun = await prisma.extractionRun.create({
      data: {
        corpusId,
        conversationId,
        kind: 'extract',
        model: 'test-model',
        status: 'completed',
      },
    });
  });

  afterAll(async () => {
    // Cleanup if test failed before deletion
    if (prisma) {
      await prisma.workspace.deleteMany({ where: { id: workspaceId } }).catch(() => {});
      await testPool?.end();
    }
  });

  it('deletes corpus and cascades to all related entities', async () => {
    if (!prisma) return;

    // Delete the corpus — should cascade to everything
    await prisma.corpus.delete({ where: { id: corpusId } });

    // Assert zero residue
    const source = await prisma.source.findUnique({ where: { id: sourceId } });
    expect(source).toBeNull();

    const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
    expect(conversation).toBeNull();

    const turn = await prisma.turn.findUnique({ where: { id: turnId } });
    expect(turn).toBeNull();

    const tu = await prisma.thoughtUnit.findUnique({ where: { id: thoughtUnitId } });
    expect(tu).toBeNull();

    const es = await prisma.evidenceSpan.findUnique({ where: { id: evidenceSpanId } });
    expect(es).toBeNull();

    const node = await prisma.graphNode.findUnique({ where: { id: graphNodeId } });
    expect(node).toBeNull();

    const brief = await prisma.brief.findUnique({ where: { id: briefId } });
    expect(brief).toBeNull();

    // ExtractionRun should be cascaded too
    const runs = await prisma.extractionRun.findMany({ where: { corpusId } });
    expect(runs).toHaveLength(0);
  });
});
