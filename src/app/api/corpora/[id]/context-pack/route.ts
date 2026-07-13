/**
 * POST /api/corpora/:id/context-pack
 *
 * Export an agent-ready context pack (markdown or JSON) for a corpus.
 * Contains: claims, evidence, citations, participant info — formatted for
 * consumption by AI agents needing real human discussion context.
 *
 * Body: { format?: 'markdown' | 'json' }
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: corpusId } = await params;
    const body = await request.json().catch(() => ({}));
    const format = (body.format as 'markdown' | 'json') || 'markdown';

    const corpus = await prisma.corpus.findUnique({
      where: { id: corpusId },
      select: { id: true, name: true, description: true },
    });

    if (!corpus) {
      return NextResponse.json(
        { success: false, error: 'Corpus not found' },
        { status: 404 },
      );
    }

    // Gather thought units with evidence spans
    const thoughtUnits = await prisma.thoughtUnit.findMany({
      where: { conversation: { corpusId } },
      include: {
        evidenceSpans: {
          include: { turn: { select: { text: true, startMs: true, endMs: true } } },
          take: 3,
        },
        conversation: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Gather participants
    const conversations = await prisma.conversation.findMany({
      where: { corpusId },
      include: {
        participants: {
          select: { id: true, name: true, role: true, speakerLabel: true },
        },
      },
    });

    // Gather graph edges (supports/contradicts)
    const edges = await prisma.graphEdge.findMany({
      where: { corpusId, relation: { in: ['supports', 'contradicts'] } },
      include: {
        sourceNode: { select: { label: true, kind: true } },
        targetNode: { select: { label: true, kind: true } },
      },
      take: 100,
    });

    if (format === 'json') {
      return NextResponse.json({
        success: true,
        data: {
          corpus: { id: corpus.id, name: corpus.name, description: corpus.description },
          thoughtUnits: thoughtUnits.map((tu) => ({
            id: tu.id,
            type: tu.type,
            text: tu.text,
            confidence: tu.confidence,
            conversation: tu.conversation.title,
            evidence: tu.evidenceSpans.map((es) => ({
              quote: es.quote,
              startMs: es.startMs,
              endMs: es.endMs,
              turnText: es.turn?.text,
            })),
          })),
          participants: conversations.flatMap((c) =>
            c.participants.map((p) => ({
              name: p.name,
              role: p.role,
              speakerLabel: p.speakerLabel,
              conversation: c.title,
            })),
          ),
          relations: edges.map((e) => ({
            source: e.sourceNode.label,
            target: e.targetNode.label,
            relation: e.relation,
            confidence: e.confidence,
          })),
        },
      });
    }

    // Markdown format
    const lines: string[] = [];
    lines.push(`# Context Pack: ${corpus.name}`);
    if (corpus.description) lines.push(`\n${corpus.description}`);
    lines.push(`\n## Thought Units (${thoughtUnits.length})\n`);

    for (const tu of thoughtUnits) {
      lines.push(`### [${tu.type.toUpperCase()}] ${tu.text.slice(0, 100)}`);
      lines.push(`- Confidence: ${tu.confidence}`);
      lines.push(`- Conversation: ${tu.conversation.title || 'Untitled'}`);
      if (tu.evidenceSpans.length > 0) {
        lines.push(`- Evidence:`);
        for (const es of tu.evidenceSpans) {
          lines.push(`  - "${es.quote.slice(0, 150)}" (${es.startMs}ms–${es.endMs}ms)`);
        }
      }
      lines.push('');
    }

    lines.push(`## Participants\n`);
    const allParticipants = conversations.flatMap((c) => c.participants);
    for (const p of allParticipants) {
      lines.push(`- ${p.name}${p.role ? ` (${p.role})` : ''} [${p.speakerLabel || 'unknown'}]`);
    }

    lines.push(`\n## Relations\n`);
    for (const e of edges) {
      lines.push(`- ${e.sourceNode.label} **${e.relation}** ${e.targetNode.label}`);
    }

    return new NextResponse(lines.join('\n'), {
      headers: { 'Content-Type': 'text/markdown' },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to export context pack' },
      { status: 500 },
    );
  }
}
