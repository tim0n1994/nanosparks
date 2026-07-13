/**
 * POST /api/corpora/:id/query
 *
 * Ask a natural language question about a corpus.
 * v2: uses hybridSearch() (dense + FTS + RRF + graph expansion) and
 *     verifyCitations() for faithfulness.
 *
 * Flow:
 * 1. Generate embedding for the query
 * 2. hybridSearch(): dense top-50 + FTS top-50 → RRF → graph expand
 * 3. Fetch ThoughtUnits with evidence spans
 * 4. LLM generates answer with citations
 * 5. verifyCitations(): strip unverifiable citations
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { OpenAIClient } from '@/lib/llm/client';
import { getRoutedLlmSettings, getConsentStatusForConversation } from '@/lib/extraction/model-router';
import { sanitizeForPrompt } from '@/lib/prompt-sanitize';
import { generateEmbedding } from '@/lib/embeddings';
import { hybridSearch } from '@/lib/rag/hybrid-search';
import { verifyCitations, stripUnverifiedCitations } from '@/lib/rag/citation-verifier';
import { logger } from '@/lib/logger';

interface QueryRequest {
  query: string;
  maxResults?: number;
  /** Search mode: 'keyword' | 'semantic' | 'hybrid' (default: 'hybrid') */
  mode?: 'keyword' | 'semantic' | 'hybrid';
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: corpusId } = await params;
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

    // ── Step 1: Generate query embedding ──
    let queryVector: number[] = [];
    try {
      queryVector = await generateEmbedding(body.query);
    } catch {
      logger.warn('Failed to generate query embedding, falling back to FTS-only');
    }

    // ── Step 2: Hybrid search (dense + FTS → RRF → graph expansion) ──
    let searchResults: Array<{
      thoughtUnitId: string;
      text: string;
      type: string;
      conversationId: string;
      score: number;
      denseScore?: number;
      ftsRank?: number;
      graphExpanded?: boolean;
    }> = [];

    if (mode === 'hybrid' && queryVector.length > 0) {
      // Full hybrid: dense + FTS + RRF + graph
      searchResults = await hybridSearch(body.query, queryVector, {
        corpusId,
        topK: 50,
        limit: maxResults,
        graphExpansion: true,
      });
    } else if (mode === 'semantic' && queryVector.length > 0) {
      // Semantic only: use hybridSearch without graph expansion
      searchResults = await hybridSearch(body.query, queryVector, {
        corpusId,
        topK: 50,
        limit: maxResults,
        graphExpansion: false,
      });
    } else {
      // Keyword only: FTS search via hybridSearch with empty vector
      // (hybridSearch handles empty dense gracefully)
      searchResults = await hybridSearch(body.query, queryVector.length > 0 ? queryVector : [0], {
        corpusId,
        topK: 50,
        limit: maxResults,
        graphExpansion: false,
      });
    }

    if (searchResults.length === 0) {
      return NextResponse.json({
        answer: 'I could not find any relevant information in this corpus for your question.',
        sources: [],
        thoughtUnits: [],
        searchMode: mode,
      });
    }

    // ── Step 3: Fetch ThoughtUnits with evidence spans ──
    const thoughtUnitIds = searchResults.map((r) => r.thoughtUnitId);
    const thoughtUnits = await prisma.thoughtUnit.findMany({
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

    // Re-sort by search score
    const scoreMap = new Map(searchResults.map((r) => [r.thoughtUnitId, r.score]));
    thoughtUnits.sort((a, b) => (scoreMap.get(b.id) ?? 0) - (scoreMap.get(a.id) ?? 0));

    // ── Step 4: Build context for LLM ──
    const conversationIds = [...new Set(thoughtUnits.map((tu) => tu.conversationId))];
    const conversations = await prisma.conversation.findMany({
      where: { id: { in: conversationIds } },
      select: { id: true, title: true },
    });
    const conversationMap = new Map(conversations.map((c) => [c.id, c.title]));

    const thoughtContext = thoughtUnits
      .map((tu, i) => {
        const quotes = tu.evidenceSpans
          .map((es) => `  [Quote: "${es.quote.slice(0, 150)}"]`)
          .join('\n');
        const convTitle = conversationMap.get(tu.conversationId) ?? 'Unknown';
        return `[${i + 1}] Type: ${tu.type}\n    Text: ${tu.text}\n    Source: ${convTitle}\n${quotes}`;
      })
      .join('\n\n');

    // ── Step 5: LLM generates answer with model routing ──
    const consentStatus = await getConsentStatusForConversation(conversationIds[0] ?? '').catch(() => 'unknown');
    const routedSettings = await getRoutedLlmSettings(consentStatus);

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

    const llmClient = new OpenAIClient(routedSettings.apiKey, routedSettings.model, routedSettings.baseUrl);
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

    // ── Step 6: Verify citations ──
    const searchResultObjects = searchResults.map((r) => ({
      thoughtUnitId: r.thoughtUnitId,
      text: r.text,
      type: r.type,
      conversationId: r.conversationId,
      score: r.score,
    }));

    const verification = verifyCitations(answerText, searchResultObjects);
    const verifiedAnswer = stripUnverifiedCitations(answerText, searchResultObjects);

    if (verification.unverifiedCount > 0) {
      logger.info('Citation verification', {
        verified: verification.verifiedCount,
        unverified: verification.unverifiedCount,
      });
    }

    // ── Step 7: Return structured response ──
    const sources = thoughtUnits.map((tu) => {
      const simScore = scoreMap.get(tu.id);
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
        ...(simScore !== undefined ? { rrfScore: Number(simScore.toFixed(4)) } : {}),
      };
    });

    return NextResponse.json({
      answer: verifiedAnswer,
      sources,
      searchMode: mode,
      stats: {
        thoughtUnitsFound: thoughtUnits.length,
        conversationsReferenced: conversationIds.length,
        citationsVerified: verification.verifiedCount,
        citationsUnverified: verification.unverifiedCount,
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
