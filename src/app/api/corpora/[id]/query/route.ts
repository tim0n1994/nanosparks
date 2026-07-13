/**
 * POST /api/corpora/:id/query
 *
 * Ask a natural language question about a corpus.
 * Uses the insight graph + thought units + LLM to generate evidence-backed answers.
 *
 * Flow:
 * 1. Parse the question
 * 2. Search thought units by keyword matching
 * 3. Expand through graph edges
 * 4. Build context from evidence spans
 * 5. LLM generates answer with citations
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { OpenAIClient } from '@/lib/llm/client';
import { getLlmSettings } from '@/lib/settings';
import { sanitizeForPrompt } from '@/lib/prompt-sanitize';
import { generateEmbedding } from '@/lib/embeddings';
import { searchThoughtUnits } from '@/lib/embeddings/search';
import { logger } from '@/lib/logger';

interface QueryRequest {
  query: string;
  maxResults?: number;
  /** Search mode: 'keyword' | 'semantic' | 'hybrid' (default: 'hybrid') */
  mode?: 'keyword' | 'semantic' | 'hybrid';
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const corpusId = params.id;
    const body: QueryRequest = await request.json();

    if (!body.query || typeof body.query !== 'string') {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 });
    }

    const corpus = await prisma.corpus.findUnique({
      where: { id: corpusId },
    });

    if (!corpus) {
      return NextResponse.json({ error: 'Corpus not found' }, { status: 404 });
    }

    const maxResults = Math.min(body.maxResults ?? 10, 50);
    const mode = body.mode ?? 'hybrid';

    // ── Step 1: Search thought units (keyword, semantic, or hybrid) ──
    let thoughtUnits: Array<{
      id: string;
      type: string;
      text: string;
      confidence: number;
      conversationId: string;
      evidenceSpans: Array<{
        id: string;
        startMs: number;
        endMs: number;
        quote: string;
        turn: { id: string; text: string; startMs: number; endMs: number } | null;
      }>;
      conversation: { id: string; title: string | null };
    }> = [];
    let scoreMap: Map<string, number> | undefined;

    if (mode === 'semantic' || mode === 'hybrid') {
      // Try vector search first
      try {
        const queryVector = await generateEmbedding(body.query);
        const vectorResults = await searchThoughtUnits(queryVector, {
          limit: maxResults,
          minSimilarity: 0.4,
        });

        if (vectorResults.length > 0) {
          const thoughtUnitIds = vectorResults.map((r) => r.resourceId);
          thoughtUnits = await prisma.thoughtUnit.findMany({
            where: { id: { in: thoughtUnitIds } },
            include: {
              evidenceSpans: {
                include: { turn: true },
                take: 3,
              },
              conversation: {
                select: { id: true, title: true },
              },
            },
          });

          // Re-sort by vector similarity score
          const sm = new Map(vectorResults.map((r) => [r.resourceId, r.similarity]));
          scoreMap = sm;
          thoughtUnits.sort((a, b) => (sm.get(b.id) ?? 0) - (sm.get(a.id) ?? 0));
        }
      } catch {
        // Vector search unavailable (e.g. pgvector not enabled) — fall through to keyword
        logger.warn('Vector search unavailable, falling back to keyword');
      }
    }

    // If no vector results (or keyword/hybrid mode), supplement with keyword search
    if (mode === 'keyword' || (thoughtUnits.length === 0 && mode === 'hybrid')) {
      const keywords = body.query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2)
        .slice(0, 10);

      const keywordUnits = await prisma.thoughtUnit.findMany({
        where: {
          conversation: { corpusId, status: 'completed' },
          OR: keywords.length > 0
            ? keywords.map((kw) => ({
                text: { contains: kw, mode: 'insensitive' as const },
              }))
            : undefined,
        },
        include: {
          evidenceSpans: {
            include: { turn: true },
            take: 3,
          },
          conversation: {
            select: { id: true, title: true },
          },
        },
        orderBy: { confidence: 'desc' },
        take: mode === 'hybrid' ? maxResults - thoughtUnits.length : maxResults,
      });

      // Merge: keyword results come after vector results
      if (mode === 'hybrid') {
        const existingIds = new Set(thoughtUnits.map((tu) => tu.id));
        for (const tu of keywordUnits) {
          if (!existingIds.has(tu.id)) {
            thoughtUnits.push(tu);
          }
        }
      } else {
        thoughtUnits = keywordUnits;
      }
    }

    if (thoughtUnits.length === 0) {
      return NextResponse.json({
        answer: 'I could not find any relevant information in this corpus for your question.',
        sources: [],
        thoughtUnits: [],
        searchMode: mode,
      });
    }

    // ── Step 2: Collect unique conversations for context ──
    const conversationIds = [...new Set(thoughtUnits.map((tu) => tu.conversationId))];
    const conversations = await prisma.conversation.findMany({
      where: { id: { in: conversationIds } },
      select: { id: true, title: true },
    });
    const conversationMap = new Map(conversations.map((c) => [c.id, c.title]));

    // ── Step 3: Build context for LLM ──
    const thoughtContext = thoughtUnits
      .map((tu, i) => {
        const quotes = tu.evidenceSpans
          .map((es) => `  [Quote: "${es.quote.slice(0, 150)}"]`)
          .join('\n');
        const convTitle = conversationMap.get(tu.conversationId) ?? 'Unknown';
        return `[${i + 1}] Type: ${tu.type}\n    Text: ${tu.text}\n    Source: ${convTitle}\n${quotes}`;
      })
      .join('\n\n');

    // ── Step 4: LLM generates answer ──
    // Sanitize user query to prevent prompt injection
    const safeQuery = sanitizeForPrompt(body.query)
      .replace(/\n/g, ' ')
      .replace(/\r/g, '')
      .slice(0, 1000);

    const systemPrompt = `You are an analyst assistant for the "${corpus.name}" corpus. 
Answer the user's question based ONLY on the provided thought units and evidence.
Each thought unit has a type (claim, evidence, objection, question, decision, risk, insight) and cites specific quotes.
Cite your sources by number [1], [2], etc.
If the evidence is insufficient, say so.`;

    const userPrompt = `Corpus: ${corpus.name}
Question: ${safeQuery}

Relevant thought units from conversations:
${thoughtContext}

Please answer the question based on these thought units. Cite your sources.`;

    const llmSettings = await getLlmSettings();
    const llmClient = new OpenAIClient(llmSettings.apiKey, llmSettings.model, llmSettings.baseUrl);
    let answerText = '';
    try {
      const response = await llmClient.completeWithRetry([
        { role: 'user', content: `${systemPrompt}\n\n${userPrompt}` },
      ]);
      answerText = response.content;
    } catch (llmError) {
      logger.warn('LLM query failed, falling back to keyword summary', { error: String(llmError) });
      answerText = generateKeywordSummary(thoughtUnits, conversationMap);
    }

    // ── Step 5: Return structured response ──
    const sources = thoughtUnits.map((tu) => {
      const simScore =
        (mode === 'semantic' || mode === 'hybrid')
          ? scoreMap?.get(tu.id)
          : undefined;
      const similarity = simScore !== undefined
        ? Number(simScore.toFixed(4))
        : undefined;
      return {
        thoughtUnitId: tu.id,
        type: tu.type,
        text: tu.text.slice(0, 200),
        conversationTitle: conversationMap.get(tu.conversationId) ?? null,
        confidence: tu.confidence,
        quotes: tu.evidenceSpans.map((es) => ({
          quote: es.quote,
          startMs: es.startMs,
          endMs: es.endMs,
        })),
        ...(similarity !== undefined ? { similarity } : {}),
      };
    });

    return NextResponse.json({
      answer: answerText,
      sources,
      searchMode: mode,
      stats: {
        thoughtUnitsFound: thoughtUnits.length,
        conversationsReferenced: conversationIds.length,
      },
    });
  } catch (error) {
    logger.error('Query failed', { error: String(error) });
    return NextResponse.json({ error: 'Query failed' }, { status: 500 });
  }
}

/**
 * Generate a simple keyword-based summary when LLM is unavailable.
 */
function generateKeywordSummary(
  thoughtUnits: Array<{ type: string; text: string; conversationId: string }>,
  conversationMap: Map<string, string | null>,
): string {
  const byType = new Map<string, number>();
  for (const tu of thoughtUnits) {
    byType.set(tu.type, (byType.get(tu.type) ?? 0) + 1);
  }

  const typeSummary = [...byType.entries()]
    .map(([type, count]) => `${count} ${type}(s)`)
    .join(', ');

  const conversationTitles = [...new Set(thoughtUnits.map((tu) =>
    conversationMap.get(tu.conversationId) ?? 'Unknown',
  ))];

  return `I found ${thoughtUnits.length} relevant thought units (${typeSummary}) across ${conversationTitles.length} conversations. The most relevant sources include:\n\n${thoughtUnits.slice(0, 5).map((tu, i) => `${i + 1}. [${tu.type}] ${tu.text.slice(0, 150)}`).join('\n')}\n\n(Note: This is a keyword-based summary. Connect an LLM provider for deeper analysis.)`;
}
