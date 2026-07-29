/**
 * GET /api/settings — returns LLM profiles + pipeline config
 * PUT /api/settings — updates LLM profiles + pipeline config
 *
 * Profiles are stored as a JSON blob in Setting key `llm_profiles`.
 * The "default" profile is tracked by `llm_default_profile`.
 * Pipeline module → profile mapping tracked by `pipeline.{module}.profileId`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getPipelineConfig, savePipelineConfig } from '@/lib/settings';
import { logger } from '@/lib/logger';

interface LlmProfile {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  apiFormat?: string;
}

export async function GET() {
  try {
    // Read profiles + default from DB
    const rows = await prisma.setting.findMany({
      where: { key: { in: ['llm_profiles', 'llm_default_profile'] } },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));

    let profiles: LlmProfile[] = [];
    try { profiles = JSON.parse(map.get('llm_profiles') || '[]'); } catch { /* empty */ }
    const defaultProfileId = map.get('llm_default_profile') || '';

    const pipeline = await getPipelineConfig();

    return NextResponse.json({ profiles, defaultProfileId, pipeline });
  } catch (error) {
    logger.error('Failed to read settings', { error: String(error) });
    return NextResponse.json({ error: 'Failed to read settings' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { profiles, defaultProfileId, pipeline } = body;

    // ── Save profiles ──
    if (Array.isArray(profiles)) {
      await prisma.setting.upsert({
        where: { key: 'llm_profiles' },
        update: { value: JSON.stringify(profiles) },
        create: { key: 'llm_profiles', value: JSON.stringify(profiles) },
      });
    }

    // ── Save default profile id ──
    if (typeof defaultProfileId === 'string') {
      await prisma.setting.upsert({
        where: { key: 'llm_default_profile' },
        update: { value: defaultProfileId },
        create: { key: 'llm_default_profile', value: defaultProfileId },
      });
    }

    // ── Save pipeline config ──
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
