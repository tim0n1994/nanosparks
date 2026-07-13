# NanoSparks 技术开发手册

> 基于 `human-thought-infra-architecture.md` 架构设计文档
> 日期：2026-06-04
> 状态：实施中 (Phase 0 ✅, Phase 1→2 进行中)

---

## 概述

本手册将架构设计转化为精确的可执行开发步骤，包含成熟开源方案的选型决策。

### 开源组件选型总览

| 组件 | 开源方案 | 为什么选它 | 替代方案 |
|------|----------|-----------|---------|
| **文件上传** | 原生 Web API (FormData) | 零依赖，Next.js 原生支持 | formidable(不维护), busboy(不维护) |
| **对象存储** | MinIO (dev) / S3 (prod) via `@aws-sdk/client-s3` | S3 API 标准，按 endpoint 切换 | 本地文件系统(仅dev) |
| **音频处理** | `ffmpeg-static` + `child_process.spawn` | fluent-ffmpeg 已弃用，直接调 FFmpeg 更稳定 | @ffmpeg/ffmpeg (wasm，太慢) |
| **本地转录** | WhisperX (faster-whisper + wav2vec2 + pyannote) | 已有，带 diarization，70x 实时 | 纯 Whisper |
| **云端转录** | Deepgram / AssemblyAI | 企业级准确率，留接口即可 | Speechmatics |
| **PII 脱敏** | Microsoft Presidio (Python 微服务) | 最成熟的开源 PII 框架，NLP+正则 | 自定义规则 |
| **语义搜索** | pgvector (Postgres 扩展) | M0 阶段不需额外基础设施 | Qdrant (M1) |
| **全文搜索** | Postgres tsvector | 零额外依赖，够用 | ElasticSearch |
| **向量数据库** | pgvector (M0) → Qdrant (M1) | Postgres 内嵌，无需新基础设施 | Chroma, Milvus |
| **图数据库** | Postgres 关系表 (M0) → Neo4j (M1) | M0 不需要图遍历 | Neo4j |
| **AI Agent 记忆** | Mem0 (M1) | 跨 session 时间回忆 | 自建 |
| **本地 LLM** | Ollama (可选) | 开箱即用的本地 LLM 推理 | GPT4All, llama.cpp |
| **认证** | Clerk (已有) | 已有集成，M0 保持 | NextAuth.js |

---

## Phase 0：重塑概念，不破坏现有产品 ✅

### 目标

保持 YouTube Demo 可用，同时引入新词汇和存储层。新模型与现有模型共存，后续逐步迁移。

### 已完成的交付物

- [x] 架构文档 (`docs/human-thought-infra-architecture.md`)
- [x] Prisma 模型: `Workspace`, `Corpus`, `Source`, `MediaAsset`, `Conversation`, `Participant`, `Turn`
- [x] Adapter: `src/lib/adapters/episode-to-conversation.ts`
- [x] Ingest 流水线: ingest/transcribe/analyze 同步新模型
- [x] Backfill 脚本: `prisma/backfill.ts`
- [x] 技术开发手册 (本文档)

### 退出标准验证

- [x] 首页正常加载 (200)
- [x] `/visualization/ep1` Demo 页面正常展示 (200)
- [x] `/api/health` 返回 ok
- [x] Seed 数据仍然可用
- [x] 新建 Episode 后自动创建 Source + Conversation

---

## Phase 1：有证据锚点的 Thought Units

### 目标

用类型化数据库记录替代松散 JSON analysis 字段。每个 claim/objection/evidence 都必须链接到带时间戳的源文本。

### 开源选型

| 需求 | 方案 |
|------|------|
| 数据校验 | Zod (已有) |
| LLM 输出解析 | Zod schema + 容错降级 (已有) |
| 缓存 | LLM Client 内存缓存 (已有，1h TTL) |

### 核心变更清单

#### 1.1 新增 Prisma 模型

```
ThoughtUnit
  id              String    @id @default(cuid())
  conversationId  String
  type            String    // claim | question | evidence | objection | decision | risk | insight
  text            String
  confidence      Float     @default(1.0)
  createdByModel  String?   // claude-3-5-sonnet, gpt-4o-mini
  extractionVersion String? // semver for prompt iteration
  sourceAnalysisId String?  // link back to Analysis JSON for traceability
  createdAt       DateTime  @default(now())
  evidenceSpans   EvidenceSpan[]

  @@index([conversationId])
  @@index([type])

EvidenceSpan
  id              String   @id @default(cuid())
  thoughtUnitId   String
  turnId          String?  // link to Turn
  startMs         Int
  endMs           Int
  quote           String
  confidence      Float?   @default(1.0)

  @@index([thoughtUnitId])
  @@index([turnId])
```

#### 1.2 领域类型定义

新建 `src/types/domain.ts` — 与 `src/types/analysis.ts` 分开，避免混淆。

```typescript
export type ThoughtUnitType = 'claim' | 'question' | 'evidence' | 'objection' | 'decision' | 'risk' | 'insight';

export interface ThoughtUnitInput {
  type: ThoughtUnitType;
  text: string;
  confidence: number;
  evidenceSpans: Array<{
    turnIndex: number;
    startMs: number;
    endMs: number;
    quote: string;
  }>;
}

export interface LLMThoughtUnitOutput {
  thoughtUnits: ThoughtUnitInput[];
}
```

#### 1.3 重构 LLM 提示词 (Prompts)

**原则**: 不再让 LLM 输出一个"大 blob JSON"包含 arguments/speakers/topics/quotes。改为：
- 每个 prompt 只请求一种类型的输出
- 每个输出必须包含 evidence spans（引用原文片段）
- 使用 Zod schema 验证

Prompt 变更:
- `argument-extraction.ts` → 输出 `ThoughtUnit[]` (type=claim/objection/evidence)
- `speaker-identification.ts` → 保持输出 speakers，但增加 evidence spans
- `topic-extraction.ts` → 保持输出 topics
- `quote-extraction.ts` → 输出 ThoughtUnit (type=evidence) with high-signal quotes
- `reference-generation.ts` → 不输出 ThoughtUnit，保持输出 ReferenceLink

#### 1.4 改写 analyze job

1. 在 `prisma.analysis.create` **之后**，解析其 JSON 字段并写入 `ThoughtUnit` + `EvidenceSpan`
2. 保留现有 `Analysis` JSON 字段作为向后兼容
3. Conversation 状态更新保持不变

**为什么是双写策略？**
- 现有可视化组件 (`IdeaMap`, `ArgumentThread`, `SpeakerTimeline`) 从 `Analysis` JSON 读取
- 新组件从 `ThoughtUnit` + `EvidenceSpan` 表读取
- 渐进迁移，两边都可用

#### 1.5 更新 visualize page（可选）

在现有可视化页面下方加一个 "Thought Units (Structured)" 面板来验证新模型数据。

### 退出标准

- [ ] 每个 COMPLETED episode 都有对应的 ThoughtUnit 记录
- [ ] 每个 ThoughtUnit 至少有 1 个 EvidenceSpan
- [ ] 错误 LLM JSON 优雅降级（不阻塞 pipeline）
- [ ] 现有可视化仍然从 Analysis JSON 正常展示
- [ ] tsc --noEmit 零错误

---

## Phase 2：多来源对话导入

### 目标

扩展到 YouTube 之外。支持文件上传、转录文本导入，统一 pipeline。

### 开源选型

| 需求 | 方案 | 理由 |
|------|------|------|
| 文件上传 | 原生 Web API (FormData) | 零依赖，Next.js 原生 |
| 音频处理 | `ffmpeg-static` + `child_process.spawn` | fluent-ffmpeg 已弃用 |
| 对象存储 | MinIO (dev) / S3 (prod) via `@aws-sdk/client-s3` | S3 API 标准，切换容易 |
| 本地 STT | WhisperX (Python) | 已有 |
| 云端 STT | Deepgram / AssemblyAI (接口预留) | 企业级准确率 |

### 核心变更清单

#### 2.1 转录抽象接口

新建 `src/lib/transcription/provider.ts`:

```typescript
export interface TranscriptionResult {
  segments: Array<{
    startMs: number;
    endMs: number;
    text: string;
    speakerLabel?: string;
    confidence?: number;
  }>;
  language?: string;
  durationMs?: number;
  provider: string;
}

export interface TranscriptionProvider {
  transcribe(input: {
    mediaPath?: string;
    mediaBuffer?: Buffer;
    mimeType?: string;
  }): Promise<TranscriptionResult>;
  
  getProviderName(): string;
}
```

#### 2.2 改造现有 Whisper 脚本

将 `src/lib/transcription/whisper.ts` 改造为 `LocalWhisperProvider implements TranscriptionProvider`。

#### 2.3 文件上传 API

新建 `src/app/api/upload/route.ts`:

- 接受 multipart/form-data (File)
- 保存到对象存储（M0 使用本地文件系统）
- 创建 Source + MediaAsset 记录
- 将 sourceId 入队到 ingest 队列

```typescript
POST /api/upload
Content-Type: multipart/form-data

{
  "file": (binary audio/video file),
  "corpusId": "string",
  "title": "optional title"
}

Response:
{
  "sourceId": "string",
  "conversationId": "string",
  "status": "pending"
}
```

#### 2.4 转录文本导入 API

新建 `POST /api/sources` — 接受预设文本转录，跳过 transcription 步骤。

#### 2.5 通用 Ingest Pipeline

重构 `src/lib/queue/jobs/ingest.ts`:

当前: 硬编码 YouTube → 改为根据 `source.sourceType` 分发:
- `sourceType=youtube` → 现有流程
- `sourceType=upload` → 直接进入 transcribe
- `sourceType=transcript` → 直接进入 analyze

#### 2.6 对象存储抽象

新建 `src/lib/storage/provider.ts`:

```typescript
export interface StorageProvider {
  save(key: string, buffer: Buffer, mimeType: string): Promise<string>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  getPublicUrl(key: string): string;
}
```

实现:
- `LocalStorageProvider` — M0 开发用
- `S3StorageProvider` — 生产用 (MinIO / AWS S3)

### 退出标准

- [ ] 文件上传 API 返回正确
- [ ] 上传媒体后自动进入 transcription + analysis pipeline
- [ ] 转录文本导入直接进入 analysis pipeline
- [ ] tsc --noEmit 零错误
- [ ] 现有 YouTube pipeline 仍然正常

---

## Phase 3：Corpus 级洞察图谱

### 目标

支持跨大量对话的情报抽取、问答和趋势分析。

### 开源选型

| 需求 | 方案 | 理由 |
|------|------|------|
| 语义搜索 | pgvector (Postgres 扩展) | 零额外基础设施 |
| 全文搜索 | Postgres tsvector | 零额外依赖 |
| 图关系 | Postgres 关系表 | M0 不需要 Neo4j |
| 图谱可视化 | Cytoscape.js (已有) | 已集成 |

### 核心变更清单

#### 3.1 新增 Prisma 模型

```
GraphNode
  id              String   @id @default(cuid())
  corpusId        String
  kind            String   // entity | concept | claim_cluster | topic | participant | artifact | decision | open_question
  label           String
  canonicalText   String?
  metadataJson    Json?
  createdAt       DateTime @default(now())

  @@index([corpusId])
  @@index([kind])

GraphEdge
  id              String   @id @default(cuid())
  corpusId        String
  sourceNodeId    String
  targetNodeId    String
  relation        String   // supports | contradicts | refines | depends_on | answers | cites | exemplifies | raised_by | agreed_by | disputed_by
  confidence      Float    @default(1.0)
  evidenceJson    Json?    // array of { thoughtUnitId, quote, timestamp }
  createdAt       DateTime @default(now())

  @@index([corpusId])
  @@index([sourceNodeId])
  @@index([targetNodeId])
```

#### 3.2 Corpus QA API

`POST /api/corpora/:id/query`:
1. 接收自然语言问题
2. 关键词提取 + pgvector 语义搜索
3. 沿 GraphEdge 扩展上下文
4. LLM 生成带 EvidenceSpan 引用的回答

#### 3.3 趋势报告

后台 job 定期扫描 corpus 内所有 ThoughtUnit，输出:
- 重复出现最多的 claims
- 有争议的主题 (support/contradict 边最多的节点)
- 未解决问题 (type=question 且没有 answer 边的)
- 决策时间线

---

## Phase 4：隐私与共享加固

### 目标

使私密对话数据达到严肃使用的安全标准。

### 开源选型

| 需求 | 方案 |
|------|------|
| PII 检测 | Microsoft Presidio (Python 微服务) |
| 脱敏 | Presidio Anonymizer |
| 审计日志 | Postgres audit_log 表 |
| 共享链接 | JWT + scoped visibility |

### 核心变更清单

- Source.consentStatus 和 visibility API 强制校验
- 删除级联覆盖所有派生产物
- PII 脱敏 job (Presidio)
- Audit log
- 共享 Brief 链接 (JWT + 作用域)

---

## Phase 5：专用基础设施

### 目标

在查询模式真实出现后加入专用存储。每个新增基础设施必须有可测量瓶颈、迁移计划、回滚计划和本地 dev 方案。

### 决策门

| 模式 | 条件 | 方案 |
|------|------|------|
| 语义搜索 | Postgres tsvector 不够或延迟 >500ms | pgvector → Qdrant |
| 图遍历 | 关系 JOIN 查询 >5 层且慢 | Neo4j |
| Agent 记忆 | 跨 session 时间回忆需求明确 | Mem0 |
| 实时会议 | 需要精确参与者级音轨 | Recall.ai |

---

## 开源选型决策记录

### D1: 文件上传 — 原生 Web API

**决策**: 使用 `request.formData()` (Next.js 原生)
**理由**: formidable/busboy 已不再积极维护，且不适用于 App Router 的新请求生命周期。
**风险**: 大文件 (>100MB) 可能内存压力 → 使用流式写入临时文件或直接上传到 S3。

### D2: 对象存储 — @aws-sdk/client-s3 + 切换 endpoint

**决策**: 使用 AWS SDK for JavaScript v3 的 S3 客户端，开发环境指向 MinIO，生产指向 S3/R2。
**理由**: S3 API 是事实标准。MinIO 完全兼容。切换只需改 endpoint。
**实施**: 新建 `src/lib/storage/provider.ts` 接口 + `S3StorageProvider` 实现 + `LocalStorageProvider` 开发用。

### D3: 音频处理 — ffmpeg-static + child_process.spawn

**决策**: 使用 `ffmpeg-static` 提供二进制，`child_process.spawn` 执行命令。
**理由**: fluent-ffmpeg 已弃用归档。直接 spawn FFmpeg 更稳定、更可控。
**注意**: 始终使用数组参数（非 shell 字符串）防止命令注入。

### D4: PII 脱敏 — Microsoft Presidio

**决策**: M1 阶段引入 Presidio 作为独立 Python 微服务。
**理由**: Presidio 是唯一成熟的、支持 NLP 的开源 PII 框架。Python 原生，部署为独立容器。
**M0 替代**: 先用正则 (email, phone, SSN) + 关键词黑名单做基础脱敏。

### D5: 语义搜索 — pgvector (M0) → Qdrant (M1)

**决策**: M0 使用 pgvector（Postgres 扩展），M1 按需评估 Qdrant。
**理由**: pgvector 零额外基础设施，架构文档 Section 8.1 明确规定。

### D6: 认证 — Clerk (保持)

**决策**: 保持现有 Clerk 集成不做改动。
**理由**: 已有，有条件包装器跳过非法 key，足够 M0 使用。

### D7: 本地 LLM — Ollama (可选)

**决策**: 不作为 M0 依赖。如果用户需要在断网环境运行，可作为 Claude/OpenAI 降级方案。
**理由**: 架构文档未要求。M0 保持朴素。

---

## 当前状态

### 已完成

- Phase 0: ✅ 全部交付物完成
- 技术开发手册: ✅ v1 (包含全部 5 阶段 + 开源选型决策)

### 进行中

- Phase 1: 实施中 (ThoughtUnit + EvidenceSpan 模型 / LLM 重构)
- Phase 2: 实施中 (转录抽象 / 文件上传 / 通用 pipeline)

### 待启动

- Phase 3: 等待 Phase 1+2 稳定
- Phase 4: 等待 Phase 3 稳定
- Phase 5: 按决策门触发
