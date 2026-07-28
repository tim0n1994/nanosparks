/**
 * GET /api/settings — returns current LLM settings (without full API key)
 * PUT /api/settings — updates LLM settings
 */

import { NextRequest, NextResponse } from 'next/server';
import { getLlmSettings, saveLlmSettings } from '@/lib/settings';
import { resetEmbeddingProvider } from '@/lib/embeddings';
import { logger } from '@/lib/logger';

export async function GET() {
  try {
    const settings = await getLlmSettings();
    // Mask the API key for display (show last 4 chars)
    const maskedKey = settings.apiKey
      ? `...${settings.apiKey.slice(-4)}`
      : '';
    return NextResponse.json({
      baseUrl: settings.baseUrl,
      apiKey: maskedKey,
      model: settings.model,
      apiFormat: settings.apiFormat ?? 'openai',
      secondary: settings.secondary,
    });
  } catch (error) {
    logger.error('Failed to read settings', { error: String(error) });
    return NextResponse.json({ error: 'Failed to read settings' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { baseUrl, apiKey, model, apiFormat, secondary } = body;

    if (!baseUrl || typeof baseUrl !== 'string') {
      return NextResponse.json({ error: 'baseUrl is required' }, { status: 400 });
    }
    if (!apiKey || typeof apiKey !== 'string') {
      return NextResponse.json({ error: 'apiKey is required' }, { status: 400 });
    }
    if (!model || typeof model !== 'string') {
      return NextResponse.json({ error: 'model is required' }, { status: 400 });
    }
    if (apiFormat && apiFormat !== 'openai' && apiFormat !== 'anthropic') {
      return NextResponse.json({ error: 'apiFormat must be "openai" or "anthropic"' }, { status: 400 });
    }

    // Validate URL format
    try {
      new URL(baseUrl);
    } catch {
      return NextResponse.json({ error: 'baseUrl must be a valid URL' }, { status: 400 });
    }

    await saveLlmSettings({ baseUrl, apiKey, model, apiFormat, secondary });
    // Reset cached embedding provider so it picks up the new baseUrl/apiKey
    resetEmbeddingProvider();
    logger.info('LLM settings updated', { baseUrl, model, apiFormat });

    return NextResponse.json({ success: true, message: 'LLM settings updated' });
  } catch (error) {
    logger.error('Failed to update settings', { error: String(error) });
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}
