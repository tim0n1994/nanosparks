import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

import { prisma } from '@/lib/prisma';
import { getLlmSettings, normalizeEndpoint, detectApiFormat } from '@/lib/settings';

export async function POST(request: NextRequest) {
  try {
    let { baseUrl, apiKey, model, apiFormat } = await request.json();

    // If apiKey is empty, fall back to the saved key from DB.
    if (!apiKey) {
      const saved = await getLlmSettings();
      apiKey = saved.apiKey;
      baseUrl = baseUrl || saved.baseUrl;
      model = model || saved.model;
      apiFormat = apiFormat || saved.apiFormat;
    }

    if (!baseUrl || !apiKey || !model) {
      return NextResponse.json({ error: 'baseUrl, apiKey, and model are required' }, { status: 400 });
    }

    const normalizedBase = normalizeEndpoint(baseUrl);
    const isAnthropic = detectApiFormat(baseUrl, apiFormat) === 'anthropic';

    if (isAnthropic) {
      // Anthropic Messages API format (CCR / Claude)
      const url = `${normalizedBase.replace(/\/+$/, '')}/messages`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Reply with just the word: OK' }],
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const data = await res.json();
        const reply = data.content?.[0]?.text || '(empty)';
        return NextResponse.json({ success: true, reply: reply.trim() });
      }
      const err = await res.text();
      return NextResponse.json({ error: `HTTP ${res.status}: ${err.slice(0, 300)}` }, { status: 502 });
    }

    // OpenAI chat/completions format
    const chatUrl = `${normalizedBase.replace(/\/+$/, '')}/chat/completions`;
    const res = await fetch(chatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
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
    }
    const err = await res.text();
    return NextResponse.json({ error: `HTTP ${res.status}: ${err.slice(0, 300)}` }, { status: 502 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn('LLM test connection failed', { error: msg });
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
