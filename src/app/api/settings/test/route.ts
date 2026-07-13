/**
 * POST /api/settings/test
 *
 * Proxies a test request to the LLM endpoint server-side.
 * Avoids CORS issues that happen when testing from the browser directly.
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest) {
  try {
    const { baseUrl, apiKey, model } = await request.json();

    if (!baseUrl || !apiKey || !model) {
      return NextResponse.json({ error: 'baseUrl, apiKey, and model are required' }, { status: 400 });
    }

    const chatUrl = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

    const res = await fetch(chatUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with just the word: OK' }],
        max_tokens: 10,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (res.ok) {
      const data = await res.json();
      const reply = data.choices?.[0]?.message?.content || '(empty)';
      return NextResponse.json({ success: true, reply: reply.trim() });
    } else {
      const err = await res.text();
      return NextResponse.json({ error: `HTTP ${res.status}: ${err.slice(0, 300)}` }, { status: 502 });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn('LLM test connection failed', { error: msg });
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
