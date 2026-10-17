/**
 * Feature Flags — a unified, categorized registry of every toggleable system
 * capability, stored in the Setting KV table and surfaced on /admin.
 *
 * Two storage namespaces, one registry:
 *   flag.<key>      — new system-level flags (defined here)
 *   pipeline.<key>.enabled — existing pipeline toggles (owned by settings.ts)
 *
 * The registry carries human metadata (category / label / description / risk)
 * so the admin UI can render rich, grouped switches without hardcoding copy.
 * Defaults are all ON; an admin can turn any off.
 */

import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

export type FlagCategory =
  | 'access'      // 访问控制
  | 'pipeline'    // 内容管线
  | 'features'    // 核心功能
  | 'publishing'  // 内容发布
  | 'experimental'; // 实验性

export type FlagRisk = 'safe' | 'moderate' | 'dangerous';

export interface FlagMeta {
  key: string;
  category: FlagCategory;
  label: string;
  description: string;
  /** What turning this OFF actually breaks / disables. */
  impact: string;
  risk: FlagRisk;
  defaultEnabled: boolean;
}

/**
 * The canonical registry. Every entry here appears as a switch on /admin.
 * Add new flags by appending here — the UI, API, and enforcement all derive
 * from this list.
 */
export const FLAG_REGISTRY: FlagMeta[] = [
  // ── 访问控制 ──
  {
    key: 'registration_open',
    category: 'access',
    label: '开放注册',
    description: '新用户能否自助注册账号。关闭后 /sign-up 表单停用。',
    impact: '关闭后只有管理员可手动创建用户。',
    risk: 'moderate',
    defaultEnabled: true,
  },
  {
    key: 'public_podcast_pages',
    category: 'access',
    label: '公开播客页 /p/*',
    description: '未登录访客能否浏览公开剧集页面 /p/[slug]。',
    impact: '关闭后公开页也要求登录（影响 SEO 抓取）。',
    risk: 'moderate',
    defaultEnabled: true,
  },
  {
    key: 'public_share_links',
    category: 'access',
    label: '公开分享链接',
    description: '能否生成无需登录即可访问的 /share/[shareId] 链接。',
    impact: '关闭后现有分享链接对未登录用户失效。',
    risk: 'moderate',
    defaultEnabled: true,
  },
  {
    key: 'public_reading',
    category: 'access',
    label: '公开阅读页 /read',
    description: '阅读页 /read/[conversationId] 是否对未登录开放。',
    impact: '关闭后阅读需登录。',
    risk: 'moderate',
    defaultEnabled: true,
  },

  // ── 内容管线（与 settings.ts pipeline.* 共享存储，关闭会跳过该处理步骤）──
  {
    key: 'extraction',
    category: 'pipeline',
    label: '观点抽取',
    description: '从转写文本抽取 ThoughtUnit（主张/问题/证据/异议/决策等）。',
    impact: '关闭后新剧集不再生成观点单元，已有数据保留。',
    risk: 'dangerous',
    defaultEnabled: true,
  },
  {
    key: 'correction',
    category: 'pipeline',
    label: '转写纠错',
    description: '对 ASR 转写文本做 LLM 纠错（错别字/专有名词）。',
    impact: '关闭后转写文本保留原始 ASR 输出。',
    risk: 'moderate',
    defaultEnabled: true,
  },
  {
    key: 'translation',
    category: 'pipeline',
    label: '双语翻译',
    description: '为每段 turn 生成中英双语翻译，驱动双语阅读器。',
    impact: '关闭后新剧集不再生成翻译（A3 双语阅读器依赖它）。',
    risk: 'moderate',
    defaultEnabled: true,
  },
  {
    key: 'entity',
    category: 'pipeline',
    label: '实体抽取',
    description: '抽取人名/机构/产品/概念实体并做跨集消解，驱动知识图谱。',
    impact: '关闭后不再构建实体层，图谱与人物档案停止更新。',
    risk: 'dangerous',
    defaultEnabled: true,
  },
  {
    key: 'legacy',
    category: 'pipeline',
    label: '旧版分析 JSON',
    description: '生成旧版 Analysis（arguments/speakers/topics/quotes）兼容层。',
    impact: '关闭后停止写旧版 Analysis 表（仅影响依赖旧字段的页面）。',
    risk: 'safe',
    defaultEnabled: true,
  },
  {
    key: 'query',
    category: 'pipeline',
    label: '合集问答',
    description: '基于合集语料的检索增强问答（/corpora/[id]/ask）。',
    impact: '关闭后合集问答返回不可用提示。',
    risk: 'moderate',
    defaultEnabled: true,
  },

  // ── 核心功能 ──
  {
    key: 'knowledge_graph',
    category: 'features',
    label: '知识图谱',
    description: '实体/观点关系图可视化（/corpora/[id]/graph）。',
    impact: '关闭后图谱页隐藏，但底层数据仍可构建。',
    risk: 'safe',
    defaultEnabled: true,
  },
  {
    key: 'semantic_star_map',
    category: 'features',
    label: '语义星图',
    description: '基于 embedding 的 3D 语义投影可视化（EmbeddingProjection）。',
    impact: '关闭后星图视图隐藏。',
    risk: 'safe',
    defaultEnabled: true,
  },
  {
    key: 'person_chat',
    category: 'features',
    label: '人物对话',
    description: '基于人物画像的 AI 对话（/person/[id]/chat）。受 chatEnabled 门控。',
    impact: '关闭后所有人无法与人物对话，无论该人物 chatEnabled 是否为 true。',
    risk: 'moderate',
    defaultEnabled: true,
  },
  {
    key: 'persona_claim',
    category: 'features',
    label: '人物认领',
    description: '真实人物认领自己的画像档案（/person/[id]/claim）。',
    impact: '关闭后认领入口隐藏。',
    risk: 'safe',
    defaultEnabled: true,
  },
  {
    key: 'highlights',
    category: 'features',
    label: '高亮收藏',
    description: '阅读时标记金句、组织到合集（Highlight / Collection）。',
    impact: '关闭后高亮按钮隐藏，现有高亮数据保留。',
    risk: 'safe',
    defaultEnabled: true,
  },
  {
    key: 'collections',
    category: 'features',
    label: '合集',
    description: '跨播客的主题合集（/corpora, /playlists）。',
    impact: '关闭后合集创建入口隐藏。',
    risk: 'safe',
    defaultEnabled: true,
  },
  {
    key: 'reading_progress',
    category: 'features',
    label: '阅读进度',
    description: '记录每集阅读位置，支持断点续读。',
    impact: '关闭后不再记录进度。',
    risk: 'safe',
    defaultEnabled: true,
  },
  {
    key: 'search',
    category: 'features',
    label: '全局搜索',
    description: 'Cmd+K 全局搜索（剧集/人物/概念/金句）。',
    impact: '关闭后搜索入口隐藏，API 返回空。',
    risk: 'safe',
    defaultEnabled: true,
  },

  // ── 内容输入 / 发布 ──
  {
    key: 'batch_ingest',
    category: 'publishing',
    label: '批量导入',
    description: '从节目 feed 一次性导入多集（/api/ingest/batch）。',
    impact: '关闭后只允许单集导入。',
    risk: 'moderate',
    defaultEnabled: true,
  },
  {
    key: 'upload_media',
    category: 'publishing',
    label: '媒体上传',
    description: '上传本地音频/视频/转写文件（/api/upload）。',
    impact: '关闭后上传入口隐藏。',
    risk: 'moderate',
    defaultEnabled: true,
  },
  {
    key: 'content_publishing',
    category: 'publishing',
    label: '一鱼多吃发布',
    description: '生成小红书/微信/知乎卡片与文案（PublishPackage, B1）。',
    impact: '关闭后发布打包入口隐藏。',
    risk: 'safe',
    defaultEnabled: true,
  },
  {
    key: 'takedown',
    category: 'publishing',
    label: '下架管理',
    description: '管理员对公开剧集执行 DMCA/版权下架（/api/admin/takedown）。',
    impact: '关闭后下架接口拒绝执行。',
    risk: 'moderate',
    defaultEnabled: true,
  },

  // ── 实验性 ──
  {
    key: 'invite_only',
    category: 'experimental',
    label: '邀请码注册',
    description: '注册时强制要求有效的邀请码（invite-codes 系统）。',
    impact: '开启后注册需邀请码；关闭则邮箱即可注册。',
    risk: 'moderate',
    defaultEnabled: false,
  },
  {
    key: 'audio_prosody',
    category: 'experimental',
    label: '音频副语言',
    description: '抽取语速/停顿/音量/打断等副语言特征（audioProsodyJson）。',
    impact: '实验性，关闭不影响主流程。',
    risk: 'safe',
    defaultEnabled: false,
  },
];

// Pipeline flags share storage with settings.ts (pipeline.<key>.enabled keys).
const PIPELINE_KEYS = new Set(['extraction', 'correction', 'translation', 'entity', 'legacy', 'query']);

export const ALL_FLAG_KEYS = FLAG_REGISTRY.map((f) => f.key);

export const CATEGORY_META: Record<FlagCategory, { label: string; order: number }> = {
  access: { label: '访问控制', order: 0 },
  pipeline: { label: '内容管线', order: 1 },
  features: { label: '核心功能', order: 2 },
  publishing: { label: '内容输入与发布', order: 3 },
  experimental: { label: '实验性', order: 4 },
};

export type FeatureFlags = Record<string, boolean>;

function storageKey(key: string): string {
  if (PIPELINE_KEYS.has(key)) return `pipeline.${key}.enabled`;
  return `flag.${key}`;
}

/** Read all feature flags + their metadata, applying defaults. */
export async function getFeatureFlags(): Promise<FeatureFlags> {
  // Read both namespaces in one pass.
  const rows = await prisma.setting.findMany({
    where: {
      OR: [
        { key: { startsWith: 'flag.' } },
        { key: { startsWith: 'pipeline.' }, value: { in: ['true', 'false'] } },
      ],
    },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));

  const out: FeatureFlags = {};
  for (const meta of FLAG_REGISTRY) {
    const sk = storageKey(meta.key);
    const raw = map.get(sk);
    out[meta.key] = raw === undefined ? meta.defaultEnabled : raw !== 'false';
  }
  return out;
}

/** Read a single flag. */
export async function getFlag(key: string): Promise<boolean> {
  const flags = await getFeatureFlags();
  return flags[key] ?? true;
}

/** Persist a single flag to its storage namespace. */
export async function setFlag(key: string, value: boolean): Promise<void> {
  if (!ALL_FLAG_KEYS.includes(key)) {
    throw new Error(`Unknown feature flag: ${key}`);
  }
  const sk = storageKey(key);
  await prisma.setting.upsert({
    where: { key: sk },
    update: { value: String(value) },
    create: { key: sk, value: String(value) },
  });
  logger.info('Feature flag updated', { flag: key, value, storage: sk });
}

/** Persist a partial set of flags. */
export async function saveFeatureFlags(updates: Record<string, boolean>): Promise<void> {
  for (const [key, value] of Object.entries(updates)) {
    if (ALL_FLAG_KEYS.includes(key)) {
      await setFlag(key, Boolean(value));
    }
  }
}

/** Convenience helpers used by route handlers for enforcement. */
export async function isFlagOn(key: string): Promise<boolean> {
  try {
    return await getFlag(key);
  } catch {
    return true; // fail open: a DB error must not lock the whole site
  }
}
