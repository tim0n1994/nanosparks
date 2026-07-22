# Phase A 执行级设计文档 — "读播客"核心 + 生产上线

> 状态：设计（落地中） | 基线：`iteration-plan-2026-07.md` I0–I6（git 982bb3c）
> 对应 PRD：`docs/iteration-plan-2026-08-production.md` v4 §4（Phase A）
> 范围：本文聚焦 Phase A 的工程契约与执行单元。Phase B/C 见各自阶段文档。

## 1. 目的（为什么做 Phase A）

把"贴链接→等→出研究图"的研究型工具，转成"贴链接→10 分钟内出一篇可读、可信、可再创作的图文"的消费产品。Phase A 不碰支付、不做自动发布、不做社区，只验证：任意播客链接 → 带说话人全文 → 手机流畅可读 → 缓存命中秒开。

成功判据（PRD §4 退出标准）：10 条真实链接（小宇宙×3、YouTube×2、Apple Podcasts×2、RSS×1、B站×1、mp3 直链×1）全部 10 分钟内出带说话人全文；缓存命中秒开；手机阅读流畅；邀请注册可用；单集成本实测入库。

## 2. 现状快照（As-Is）

| 维度 | 现状 | 缺口 |
|------|------|------|
| 链接接入 | ingest route 内嵌两分支（isXiaoyuzhou / parseYouTubeUrl） | 只认小宇宙+YouTube；无统一 resolver 链 |
| 转写 | factory.ts = Deepgram 或 local-whisper | 无阿里百炼 Paraformer（原生 word 级时间戳+speaker_id） |
| 缓存 | 无 | 每用户首转重跑全管线，成本不复利，热门集无秒开 |
| 阅读 | 无 /read/[conversationId] | "读"的产品形态缺失 |
| 数据模型 | Source.kind/sourceType 字符串；无 GlobalEpisode | 平台枚举缺失；全局缓存地基缺失 |

## 3. 架构总览

```
submit(URL) → ResolverChain(8源) → ResolvedEpisode(episodeKey)
                                        │
                            ┌───────────┴───────────┐
                            ▼                       ▼
                  GlobalEpisode 查表         未命中→ FlowProducer
                  命中→引用共享会话秒开       transcribe+diarize 并行
                  (上传文件永不入共享层)      →normalize→纠错pass→extract
                            │                       │
                            └──────────┬────────────┘
                                       ▼
                          Conversation(Turn/Participant/ThoughtUnit)
                                       │
                                       ▼
                          /read/[conversationId] 阅读器
```

核心不变量：
- episodeKey 全局唯一 = platform:platformId（无平台 ID 用音频 content-hash 兜底）。
- 共享层只读：转写/导读/金句/Turn 跨用户共享；私有层（高亮/笔记/Brief/进度/翻译）按用户隔离。
- 上传文件永不入共享缓存（隐私边界）。

## 4. 模块与契约

### 4.1 Resolver 链（src/lib/resolvers/）

统一入口，对齐 xiaoyuzhou/parser.ts 小模块模式。

```ts
export type SourcePlatform =
  | 'xiaoyuzhou' | 'youtube' | 'apple_podcasts' | 'spotify'
  | 'rss' | 'bilibili' | 'direct' | 'generic';

export interface ResolvedEpisode {
  platform: SourcePlatform;
  platformId: string;
  episodeKey: string;            // `${platform}:${platformId}`
  title: string;
  description?: string;
  audioUrl: string;
  durationSec?: number;
  coverUrl?: string;
  showTitle?: string;
  sourceUrl: string;             // 版权回链
  isMultiEpisode?: boolean;
  episodes?: ResolvedEpisode[];
}

export interface Resolver {
  name: string;
  canHandle(url: string): boolean;
  resolve(url: string, ctx: ResolveCtx): Promise<ResolvedEpisode>;
}
```

链顺序（首个 canHandle=true 即用）：xiaoyuzhou → youtube → bilibili → apple_podcasts → spotify → rss → direct → generic(yt-dlp)。

### 4.2 全局转写缓存（src/lib/resolvers/cache.ts + GlobalEpisode）

- 命中：Conversation 已存在 → 当前用户 Corpus 引用同一 conversationId（共享层只读），readCount++，跳过管线，cached: true。
- 未命中：建 GlobalEpisode + Conversation，cached: false，后续走 FlowProducer。
- 上传文件：isUpload=true 时永不查/不写共享缓存，直接建私有 Conversation。

### 4.3 ASR 路由（src/lib/transcription/）

- 新增 ParaformerProvider（阿里百炼录音文件识别，异步）：输入公网 URL → submit → 轮询 → JSON；输出 sentences[].words[]{begin,end,text} + speaker_id → TranscriptSegment（带 speakerLabel + words[]）。≤2h 单文件，超长走 chunker 切片。
- factory 升级为语种路由：中文→Paraformer，英文→Deepgram，探测首 60s 语种再路由，Setting 可覆盖。
- LLM 纠错 pass（进 extract 前）：术语纠错 + 口癖压缩 + 中英夹杂规范。成本进 ExtractionRun.costUsd。

### 4.4 阅读器（/read/[conversationId]，A3）

Hero（封面/节目名/主播/时长/原链接回链）→ TL;DR（一句话+3-5要点）→ 章节导航 sticky → 金句墙 → 正文（Turn 聚段、说话人色条、时间戳 chip seek、金句内联高亮）→ 导出/图谱入口。性能：2h≈600-1000 Turn，首章节 SSR + 章节懒加载。双语对照：Turn.translationJson，原文/译文/对照三模式。进度：ReadingProgress(userId, conversationId, turnIndex)。

## 5. 数据模型增量（对应 PRD §10）

| 实体 | 新增字段 | 阶段 |
|------|---------|------|
| GlobalEpisode | episodeKey @unique, conversationId, readCount, firstIngestedAt | A1 |
| Source 扩展 | platform 枚举 + apple_podcasts/rss/bilibili/generic；publicSlug；claimedByUserId | A1 |
| Turn 扩展 | translationJson Json?（语言→文本 map） | A3 |
| ReadingProgress | userId, conversationId, turnIndex, updatedAt | A3 |

## 6. 执行顺序与验收

A0（卫生）→ A1（数据模型+resolver+缓存+接入）→ A2（Paraformer+路由+纠错pass）→ A3（阅读器+进度+双语+SSE）→ A4（护栏+部署文档）。每步验收以可运行测试 + 类型检查 + 迁移可应用为准。

*文档版本: 1.0 | 日期: 2026-07-22*
