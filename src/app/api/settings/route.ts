/**
 * GET /api/settings — returns LLM settings + pipeline config (without full API key)
 * PUT /api/settings — updates LLM settings + pipeline config
 */

import { NextRequest, NextResponse } from 'next/server';
import { getLlmSettings, saveLlmSettings, getPipelineConfig, savePipelineConfig } from '@/lib/settings';
import { resetEmbeddingProvider } from '@/lib/embeddings';
import { logger } from '@/lib/logger';

export async function GET() {
  try {
    const settings = await getLlmSettings();
    const pipeline = await getPipelineConfig();
    const maskedKey = settings.apiKey ? `...${settings.apiKey.slice(-4)}` : '';
    return NextResponse.json({
      baseUrl: settings.baseUrl,
      apiKey: maskedKey,
      hasApiKey: !!settings.apiKey,
      model: settings.model,
      apiFormat: settings.apiFormat ?? 'openai',
      secondary: settings.secondary,
      pipeline,
    });
  } catch (error) {
    logger.error('Failed to read settings', { error: String(error) });
    return NextResponse.json({ error: 'Failed to read settings' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { baseUrl, apiKey, model, apiFormat, secondary, pipeline } = body;

    // ── LLM settings ──
    if (baseUrl && model) {
      // apiKey: if empty string, keep existing (user didn't change it)
      const current = await getLlmSettings();
      const finalKey = apiKey || current.apiKey;
      await saveLlmSettings({ baseUrl, apiKey: finalKey, model, apiFormat, secondary });
      resetEmbeddingProvider();
      logger.info('LLM settings updated', { baseUrl, model, apiFormat });
    }

    // ── Pipeline config ──
    if (pipeline && typeof pipeline === 'object') {
      await savePipelineConfig(pipeline);
      logger.info('Pipeline config updated', { modules: Object.keys(pipeline) });
    }

    return NextResponse.json({ success: true, message: 'Settings updated' });
  } catch (error) {
    logger.error('Failed to update settings', { error: String(error) });
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}
