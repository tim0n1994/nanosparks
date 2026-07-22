/**
 * Settings — LLM configuration store.
 *
 * Reads/writes LLM endpoint settings from the database (Setting table),
 * with environment-variable fallbacks so existing .env configs still work.
 *
 * Usage:
 *   import { getLlmSettings } from '@/lib/settings';
 *   const { baseUrl, apiKey, model } = await getLlmSettings();
 */

import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

export interface LlmSettings {
  /** OpenAI-compatible base URL (e.g. http://127.0.0.1:59786/v1) */
  baseUrl: string;
  /** API key */
  apiKey: string;
  /** Model name (e.g. gpt-4o-mini, qwen3.5-35b-a3b) */
  /** API format: 'openai' (chat/completions) or 'anthropic' (/v1/messages) */
  apiFormat?: 'openai' | 'anthropic';
  model: string;
}

const SETTING_KEYS = {
  LLM_BASE_URL: 'llm_base_url',
  LLM_API_KEY: 'llm_api_key',
  LLM_MODEL: 'llm_model',
} as const;

/**
 * Read all LLM settings from DB, falling back to environment variables.
 */
export async function getLlmSettings(): Promise<LlmSettings> {
  try {
    const rows = await prisma.setting.findMany({
      where: { key: { in: Object.values(SETTING_KEYS) } },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));

    return {
      baseUrl: map.get(SETTING_KEYS.LLM_BASE_URL) ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
      apiKey: map.get(SETTING_KEYS.LLM_API_KEY) ?? process.env.OPENAI_API_KEY ?? '',
      model: map.get(SETTING_KEYS.LLM_MODEL) ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    };
  } catch (error) {
    logger.warn('Failed to read LLM settings from DB, falling back to env', { error: String(error) });
    return {
      baseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
      apiKey: process.env.OPENAI_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? '',
      model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
      // Detect Anthropic Messages API format: if baseUrl contains /v1/messages or ANTHROPIC_BASE_URL is set.
      apiFormat: (process.env.OPENAI_BASE_URL?.includes('/v1') && process.env.OPENAI_BASE_URL?.includes('messages')) || process.env.ANTHROPIC_BASE_URL ? 'anthropic' : 'openai',
    };
  }
}

/**
 * Persist LLM settings to the database.
 */
export async function saveLlmSettings(settings: LlmSettings): Promise<void> {
  const entries = [
    { key: SETTING_KEYS.LLM_BASE_URL, value: settings.baseUrl },
    { key: SETTING_KEYS.LLM_API_KEY, value: settings.apiKey },
    { key: SETTING_KEYS.LLM_MODEL, value: settings.model },
  ];

  for (const { key, value } of entries) {
    await prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }
}
