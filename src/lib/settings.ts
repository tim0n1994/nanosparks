/**
 * Settings — LLM configuration store + pipeline feature toggles.
 *
 * Two layers:
 * 1. LLM endpoint (getLlmSettings / saveLlmSettings) — the "default" endpoint,
 *    used by all modules unless overridden by a per-module profile.
 * 2. Pipeline toggles (getPipelineConfig) — on/off switches + optional per-module
 *    LLM profile override (different model/endpoint for extraction vs translation vs query).
 *
 * DB keys (Setting table, all string values):
 *   llm_base_url / llm_api_key / llm_model / llm_api_format — default endpoint
 *   pipeline.extraction.enabled  — toggle ThoughtUnit extraction
 *   pipeline.correction.enabled  — toggle ASR correction pass
 *   pipeline.translation.enabled — toggle bilingual translation
 *   pipeline.entity.enabled      — toggle entity extraction
 *   pipeline.legacy.enabled      — toggle legacy Analysis JSON
 *   llm_profile.{module}         — JSON {baseUrl,apiKey,model,apiFormat} override for a module
 *                                  modules: extraction, correction, translation, query, summarize
 */

import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

export interface LlmSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  apiFormat?: 'openai' | 'anthropic';
  secondary?: { baseUrl: string; model: string; apiFormat?: 'openai' | 'anthropic' };
}

export interface PipelineConfig {
  extraction: { enabled: boolean; profile?: string };
  correction: { enabled: boolean; profile?: string };
  translation: { enabled: boolean; profile?: string };
  entity: { enabled: boolean; profile?: string };
  legacy: { enabled: boolean; profile?: string };
  query: { enabled: boolean; profile?: string };
}

// ── Setting keys ──

const SETTING_KEYS = {
  LLM_BASE_URL: 'llm_base_url',
  LLM_API_KEY: 'llm_api_key',
  LLM_MODEL: 'llm_model',
  LLM_API_FORMAT: 'llm_api_format',
  LLM_SECONDARY: 'llm_secondary',
} as const;

const PIPELINE_KEYS = [
  'pipeline.extraction.enabled',
  'pipeline.correction.enabled',
  'pipeline.translation.enabled',
  'pipeline.entity.enabled',
  'pipeline.legacy.enabled',
  'pipeline.query.enabled',
] as const;

const PIPELINE_PROFILE_KEYS = [
  'pipeline.extraction.profile',
  'pipeline.correction.profile',
  'pipeline.translation.profile',
  'pipeline.entity.profile',
  'pipeline.legacy.profile',
  'pipeline.query.profile',
] as const;

/** All pipeline keys for bulk DB read. */
export const ALL_PIPELINE_KEYS = [...PIPELINE_KEYS, ...PIPELINE_PROFILE_KEYS];

// ── Endpoint helpers ──

export function normalizeEndpoint(rawBase: string): string {
  let base = (rawBase || '').trim().replace(/\/+$/, '');
  base = base.replace(/\/messages$/, '').replace(/\/chat\/completions$/, '');
  if (!/\/v\d+$/.test(base)) base = `${base}/v1`;
  return base;
}

export function detectApiFormat(rawBase: string, explicit?: string): 'openai' | 'anthropic' {
  if (explicit === 'anthropic' || explicit === 'openai') return explicit;
  if (/\/messages\b/.test(rawBase)) return 'anthropic';
  return 'openai';
}

function parseSecondary(raw: string | undefined): LlmSettings['secondary'] {
  if (!raw) return undefined;
  try {
    const s = JSON.parse(raw) as { baseUrl?: string; model?: string; apiFormat?: 'openai' | 'anthropic' };
    if (!s.baseUrl || !s.model) return undefined;
    return { baseUrl: s.baseUrl, model: s.model, apiFormat: s.apiFormat ?? detectApiFormat(s.baseUrl) };
  } catch {
    return undefined;
  }
}

// ── Default LLM endpoint ──

export async function getLlmSettings(): Promise<LlmSettings> {
  try {
    const rows = await prisma.setting.findMany({
      where: { key: { in: Object.values(SETTING_KEYS) } },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));

    const rawBase = map.get(SETTING_KEYS.LLM_BASE_URL) ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
    const apiFormat = detectApiFormat(rawBase, map.get(SETTING_KEYS.LLM_API_FORMAT));

    return {
      baseUrl: normalizeEndpoint(rawBase),
      apiKey:
        map.get(SETTING_KEYS.LLM_API_KEY) ??
        (apiFormat === 'anthropic'
          ? process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY ?? ''
          : process.env.OPENAI_API_KEY ?? ''),
      model: map.get(SETTING_KEYS.LLM_MODEL) ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
      apiFormat,
      secondary: parseSecondary(map.get(SETTING_KEYS.LLM_SECONDARY)),
    };
  } catch (error) {
    logger.warn('Failed to read LLM settings from DB, falling back to env', { error: String(error) });
    const rawBase = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
    const apiFormat = detectApiFormat(rawBase, process.env.LLM_API_FORMAT);
    return {
      baseUrl: normalizeEndpoint(rawBase),
      apiKey: process.env.OPENAI_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? '',
      model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
      apiFormat,
    };
  }
}

export async function saveLlmSettings(settings: LlmSettings): Promise<void> {
  const entries = [
    { key: SETTING_KEYS.LLM_BASE_URL, value: settings.baseUrl },
    { key: SETTING_KEYS.LLM_API_KEY, value: settings.apiKey },
    { key: SETTING_KEYS.LLM_MODEL, value: settings.model },
    ...(settings.apiFormat ? [{ key: SETTING_KEYS.LLM_API_FORMAT, value: settings.apiFormat }] : []),
    ...(settings.secondary
      ? [{ key: SETTING_KEYS.LLM_SECONDARY, value: JSON.stringify(settings.secondary) }]
      : []),
  ];
  for (const { key, value } of entries) {
    await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
  }
}

// ── Pipeline config (toggles + per-module profiles) ──

const DEFAULT_PIPELINE: PipelineConfig = {
  extraction: { enabled: true },
  correction: { enabled: true },
  translation: { enabled: true },
  entity: { enabled: true },
  legacy: { enabled: true },
  query: { enabled: true },
};

export async function getPipelineConfig(): Promise<PipelineConfig> {
  try {
    const rows = await prisma.setting.findMany({ where: { key: { in: [...ALL_PIPELINE_KEYS] } } });
    const map = new Map(rows.map((r) => [r.key, r.value]));

    const parse = (key: string, def: boolean) => map.get(key) !== 'false' ? def : false;
    const profile = (key: string) => map.get(key) || undefined;

    return {
      extraction: { enabled: parse('pipeline.extraction.enabled', true), profile: profile('pipeline.extraction.profile') },
      correction: { enabled: parse('pipeline.correction.enabled', true), profile: profile('pipeline.correction.profile') },
      translation: { enabled: parse('pipeline.translation.enabled', true), profile: profile('pipeline.translation.profile') },
      entity: { enabled: parse('pipeline.entity.enabled', true), profile: profile('pipeline.entity.profile') },
      legacy: { enabled: parse('pipeline.legacy.enabled', true), profile: profile('pipeline.legacy.profile') },
      query: { enabled: parse('pipeline.query.enabled', true), profile: profile('pipeline.query.profile') },
    };
  } catch {
    return DEFAULT_PIPELINE;
  }
}

export async function savePipelineConfig(config: PipelineConfig): Promise<void> {
  const entries: Array<{ key: string; value: string }> = [
    { key: 'pipeline.extraction.enabled', value: String(config.extraction.enabled) },
    { key: 'pipeline.correction.enabled', value: String(config.correction.enabled) },
    { key: 'pipeline.translation.enabled', value: String(config.translation.enabled) },
    { key: 'pipeline.entity.enabled', value: String(config.entity.enabled) },
    { key: 'pipeline.legacy.enabled', value: String(config.legacy.enabled) },
    { key: 'pipeline.query.enabled', value: String(config.query.enabled) },
  ];
  for (const m of ['extraction', 'correction', 'translation', 'entity', 'legacy', 'query'] as const) {
    const p = config[m].profile;
    if (p) entries.push({ key: `pipeline.${m}.profile`, value: p });
  }
  for (const { key, value } of entries) {
    await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
  }
}

// ── Per-module LLM resolution ──

/**
 * Get LLM settings for a specific pipeline module.
 * If the module has a profile override, use that; otherwise fall back to default.
 */
export async function getLlmSettingsForModule(module: string): Promise<LlmSettings> {
  const profileKey = `pipeline.${module}.profile`;
  const row = await prisma.setting.findUnique({ where: { key: profileKey } });

  if (row?.value) {
    try {
      const p = JSON.parse(row.value) as Partial<LlmSettings>;
      const base = p.baseUrl ?? '';
      if (base) {
        return {
          baseUrl: normalizeEndpoint(base),
          apiKey: p.apiKey ?? '',
          model: p.model ?? 'gpt-4o-mini',
          apiFormat: detectApiFormat(base, p.apiFormat),
        };
      }
    } catch { /* fall through to default */ }
  }

  return getLlmSettings();
}
