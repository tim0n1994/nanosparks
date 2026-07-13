/**
 * POST /api/corpora/:id/query-stream (SSE)
 *
 * Server-Sent Events streaming answer for the Ask page.
 * Streams the LLM answer token-by-token with progressive citation cards.
 *
 * Events:
 *   - sources: { sources: [...] }  — retrieval results (sent first)
 *   - delta: { text: "..." }        — incremental answer text
 *   - done: { stats: {...} }        — final stats with citation verification
 *   - error: { message: "..." }     — error
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { OpenAIClient } from '@/lib/llm/client';
import { getRoutedLlmSettings, getConsentStatusForConversation } from '@/lib/extraction/model-router';
import { sanitizeForPrompt } from '@/lib/prompt-sanitize';
import { generateEmbedding } from '@/lib/embeddings';
import { hybridSearch } from '@/lib/rag/hybrid-search';
import { verifyCitations } from '@/lib/rag/citation-verifier';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: corpusId } = await params;
  const body = await request.json();
  const query = body.query as string;
  const maxResults = Math.min(body.maxResults ?? 10, 50);

  if (!query || typeof query !== 'string') {
    return new Response('Query is required', { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        const corpus = await prisma.corpus.findUnique({
          where: { id: corpusId },
        });

        if (!corpus) {
          send('error', { message: 'Corpus not found' });
          controller.close();
          return;
        }

        // ── Step 1: Hybrid search ──
        let queryVector: number[] = [];
        try {
          queryVector = await generateEmbedding(query);
        } catch {
          // Fallback to FTS-only
        }

        const searchResults = await hybridSearch(query, queryVector, {
          corpusId,
          topK: 50,
          limit: maxResults,
          graphExpansion: true,
        });

        if (searchResults.length === 0) {
          send('delta', { text: 'I could not find any relevant information in this corpus for your question.' });
          send('done', { stats: { thoughtUnitsFound: 0 } });
          controller.close();
          return;
        }

        // ── Step 2: Fetch ThoughtUnits with evidence ──
        const thoughtUnitIds = searchResults.map((r) => r.thoughtUnitId);
        const thoughtUnits = await prisma.thoughtUnit.findMany({
          where: { id: { in: thoughtUnitIds } },
          include: {
            evidenceSpans: { include: { turn: true }, take: 3 },
            conversation: { select: { id: true, title: true } },
          },
        });

        const scoreMap = new Map(searchResults.map((r) => [r.thoughtUnitId, r.score]));
        thoughtUnits.sort((a, b) => (scoreMap.get(b.id) ?? 0) - (scoreMap.get(a.id) ?? 0));

        // Send sources first (progressive citation cards)
        const sources = thoughtUnits.map((tu, i) => ({
          index: i + 1,
          thoughtUnitId: tu.id,
          type: tu.type,
          text: tu.text.slice(0, 200),
          conversationTitle: tu.conversation.title,
          confidence: tu.confidence,
          quotes: tu.evidenceSpans.map((es) => ({
            quote: es.quote,
            startMs: es.startMs,
            endMs: es.endMs,
          })),
          rrfScore: scoreMap.get(tu.id),
        }));
        send('sources', { sources });

        // ── Step 3: Build context and stream LLM response ──
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

        const consentStatus = await getConsentStatusForConversation(conversationIds[0] ?? '').catch(() => 'unknown');
        const routedSettings = await getRoutedLlmSettings(consentStatus);

        const safeQuery = sanitizeForPrompt(query).replace(/\n/g, ' ').slice(0, 1000);

        const systemPrompt = `You are an analyst assistant for the "${corpus.name}" corpus.
Answer the user's question based ONLY on the provided thought units and evidence.
Cite your sources by number [1], [2], etc.
If the evidence is insufficient, say so.`;

        const userPrompt = `Corpus: ${corpus.name}
Question: ${safeQuery}

Relevant thought units from conversations:
${thoughtContext}

Please answer the question based on these thought units. Cite your sources.`;

        // ── Step 4: Stream the LLM response ──
        const llmClient = new OpenAIClient(routedSettings.apiKey, routedSettings.model, routedSettings.baseUrl);

        let fullAnswer = '';
        try {
          // Use the streaming completions API
          const response = await fetch(`${routedSettings.baseUrl ?? 'https://api.openai.com/v1'}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${routedSettings.apiKey}`,
            },
            body: JSON.stringify({
              model: routedSettings.model,
              max_tokens: 4096,
              stream: true,
              messages: [
                { role: 'user', content: `${systemPrompt}\n\n${userPrompt}` },
              ],
            }),
          });

          if (!response.ok || !response.body) {
            throw new Error(`LLM API error: ${response.status}`);
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6).trim();
                if (data === '[DONE]') continue;

                try {
                  const parsed = JSON.parse(data);
                  const delta = parsed.choices?.[0]?.delta?.content;
                  if (delta) {
                    fullAnswer += delta;
                    send('delta', { text: delta });
                  }
                } catch {
                  // Skip malformed chunks
                }
              }
            }
          }
        } catch (llmError) {
          logger.warn('LLM streaming failed, falling back to non-streaming', { error: String(llmError) });
          // Fallback: non-streaming
          const llmResponse = await llmClient.completeWithRetry([
            { role: 'user', content: `${systemPrompt}\n\n${userPrompt}` },
          ]);
          fullAnswer = llmResponse.content;
          // Send in chunks to simulate streaming
          const chunkSize = Math.ceil(fullAnswer.length / 20);
          for (let i = 0; i < fullAnswer.length; i += chunkSize) {
            send('delta', { text: fullAnswer.slice(i, i + chunkSize) });
          }
        }

        // ── Step 5: Verify citations ──
        const verification = verifyCitations(fullAnswer, searchResults);

        send('done', {
          stats: {
            thoughtUnitsFound: thoughtUnits.length,
            conversationsReferenced: conversationIds.length,
            citationsVerified: verification.verifiedCount,
            citationsUnverified: verification.unverifiedCount,
          },
        });

        controller.close();
      } catch (error) {
        logger.error('Query stream failed', { error: String(error) });
        send('error', { message: String(error) });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
