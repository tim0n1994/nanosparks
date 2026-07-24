# 实施规格：知识呈现体系（可直接交付 GLM 执行）— 2026-08

> 类型：实施规格（Implementation Spec）。母文档 `docs/prd-knowledge-presentation-2026-08.md`（讲 why），本文讲 **what/where/how**：确切文件路径、Prisma DDL、API 契约、函数签名、组件树、验收标准。
> 执行者：GLM。执行原则见 §0。
> 代码基线：Next 16 / React 19 / Prisma 7（client 在 `src/generated/prisma`）/ Tailwind 4 / Zod 4 / BullMQ FlowProducer。

---

## §0 全局约定（GLM 每个任务都必须遵守）

1. **动手前先侦察**：每个 Track 开始前跑该 Track 顶部的「侦察命令」，确认当前代码状态（代码库是活的，可能已有部分实现）。**发现已存在的组件/函数就扩展，不重建。**
2. **API 响应信封**（全项目统一，见 `src/lib/` 现有路由）：
   ```ts
   type ApiResponse<T> = { success: boolean; data?: T; error?: string; meta?: Record<string, unknown> }
   ```
   注意：部分老路由直接返回裸对象（如 `graph/route.ts` 返回 `{ error }`），**新路由一律用信封**。
3. **路由签名**（Next 16）：`{ params }: { params: Promise<{ id: string }> }`，`const { id } = await params`。
4. **鉴权**：写接口复制 `src/app/api/ingest/route.ts` 的 `isValidClerkKey` + `auth()` 模式；读接口视可见性（公开页免鉴权）。
5. **LLM 调用**：用 `src/lib/llm/client.ts` 的 `OpenAIClient` / `ClaudeClient`，方法 `completeStructured(messages, zodSchema, { maxTokens, schemaName })`（自带缓存+重试+宽松 JSON 解析）。**不要新建 LLM 封装。**
6. **模型路由**：走 `src/lib/extraction/model-router.ts` 的 `getRoutedLlmSettings(conversationId)`；抽取用便宜模型，合成/仲裁可升配。
7. **成本记账**：任何 LLM 批处理挂 `ExtractionRun`（`kind` 字段区分 extract/embed/graph/entity/persona），成本写 `costUsd`。沿用 analyze.ts 的 run 创建模式。
8. **类型**：新增领域类型进 `src/types/domain.ts`；组件 props 用具名 `interface`；禁止 `any`（外部输入用 `unknown` 收窄）。
9. **迁移**：所有 schema 改动汇总在 §2，用 `npx prisma migrate dev --name <name>` 生成；改完跑 `npm run db:generate`。
10. **验收即测试**：每个非平凡任务留一个 `src/__tests__/*.test.ts`（vitest）覆盖核心逻辑（消解/合并/路由/拒答）。前端交互留一条 Playwright spec 挂到 `e2e/`。
11. **提交粒度**：一个任务一个 commit，`feat(vN): <task-id> <desc>`；type-check（`npm run type-check`）零错误才算完成。

---

## §1 依赖增量（一次性安装）

```bash
# 前端可视化
npm i sigma graphology graphology-layout-forceatlas2 graphology-communities-louvain graphology-metrics
npm i @deck.gl/core @deck.gl/layers @deck.gl/react
npm i d3-scale d3-shape d3-array   # L0 泳道/河流（若已装跳过）

# 后端：降维 + 聚类（Node 侧，纯 JS，无 Python 依赖）
npm i umap-js density-clustering
```

- **不装**：three.js/R3F（3D 星图 P2 用 deck.gl OrbitView，不引全家桶）、任何 GraphRAG/LightRAG 框架、Cytoscape 新版本（将逐步下线）。
- Cytoscape 现有依赖**保留**到 V2 sigma.js 图上线并回归通过后再移除（见 T-V2-7）。

---

## §2 数据库迁移总表（按 Track 顺序，可分多次 migrate）

### 迁移 M1（随 V1，`add_attribution_stance`）
```prisma
model ThoughtUnit {
  // ... 现有字段不变 ...
  participantId String?       // 主张者（FK Participant）
  participant   Participant?  @relation(fields: [participantId], references: [id], onDelete: SetNull)
  stance        String?       // assert | oppose | question | concede | neutral
  @@index([participantId])
}
model Participant {
  // ... 现有字段 ...
  thoughtUnits ThoughtUnit[]  // 反向关系
}
```

### 迁移 M2（随 V2，`add_entity_layer`）
```prisma
model Entity {
  id            String          @id @default(cuid())
  workspaceId   String
  workspace     Workspace       @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  type          String          // person | org | product | book | concept | event
  canonicalName String
  aliasesJson   Json?           // string[]
  embeddingId   String?         // 指向 embeddings 表（用于消解/星图）
  metadataJson  Json?
  createdAt     DateTime        @default(now())
  updatedAt     DateTime        @updatedAt
  mentions      EntityMention[]
  @@unique([workspaceId, type, canonicalName])
  @@index([workspaceId, type])
}
model EntityMention {
  id             String       @id @default(cuid())
  entityId       String
  entity         Entity       @relation(fields: [entityId], references: [id], onDelete: Cascade)
  conversationId String
  turnId         String?
  surfaceForm    String
  createdAt      DateTime     @default(now())
  @@index([entityId])
  @@index([conversationId])
}
model CanonicalClaim {
  id              String   @id @default(cuid())
  corpusId        String
  corpus          Corpus   @relation(fields: [corpusId], references: [id], onDelete: Cascade)
  text            String                       // 簇代表句
  memberTuIdsJson Json                          // ThoughtUnit id[]
  entityIdsJson   Json?                         // 涉及的 Entity id[]
  firstAssertedAt DateTime?                     // E4 时间维度
  lastAssertedAt  DateTime?
  createdAt       DateTime @default(now())
  @@index([corpusId])
}
model GraphNode {
  // ... 现有字段 ...
  entityId String?   // 关联 Entity（kind=entity 时）
  @@index([entityId])
}
```
> `GraphNode.kind` 已支持 `entity|concept`（见 `src/types/domain.ts` `GraphNodeKind`），无需改枚举。新增边关系 `mentions`/`co_occurs` 是字符串，无需迁移。

### 迁移 M3（随 V2，`add_embedding_projection`）
```prisma
model EmbeddingProjection {
  id           String   @id @default(cuid())
  corpusId     String
  embeddingId  String                // 对应 embeddings 表行（thoughtUnit/quote）
  x            Float
  y            Float
  z            Float?                 // 3D 星图可选
  clusterId    Int?
  clusterLabel String?
  createdAt    DateTime @default(now())
  @@index([corpusId])
  @@index([corpusId, clusterId])
}
```

### 迁移 M4（随 V3，`add_person_profile`）
```prisma
model PersonProfile {
  id          String   @id @default(cuid())
  entityId    String   @unique          // FK Entity(type=person)
  displayName String
  statsJson   Json?                      // { showCount, episodeCount, totalMs, firstSeenAt, lastSeenAt }
  styleJson   Json?                      // { catchphrases[], metaphors[], sentencePatterns[], toneSummary }
  summaryText String?                    // 人物综述（缓存，增量失效）
  relationsJson Json?                    // { coAppears:[{entityId,count}], supports:[], contradicts:[] }
  claimed     Boolean  @default(false)
  claimedByUserId String?
  chatEnabled Boolean  @default(false)   // <3 集或敏感人物为 false
  updatedAt   DateTime @updatedAt
}
model SpeakerVoiceprint {
  id            String   @id @default(cuid())
  participantId String
  embeddingJson Json                      // number[]（CAM++ 段级嵌入均值）
  sampleMetaJson Json?
  createdAt     DateTime @default(now())
  @@index([participantId])
}
```
> `PersonProfile` 挂 `Entity`（type=person）。`Entity` 需加 `profile PersonProfile?` 反向关系。

---

## §3 Track V1 —— 说话人归属 + 集内可视化（并入 Phase A，2–3 天）

**侦察命令**：
```bash
ls src/components/reader/ src/components/visualization/; grep -rn "SpeakerTimeline\|MindmapTree\|TopicCluster" src/app/read src/components; sed -n '180,230p' src/lib/extraction/windowed-extraction.ts
```
> 已存在 `SpeakerTimeline.tsx`、`MindmapTree.tsx`、`TopicCluster.tsx`、`ArgumentThread.tsx`。V1 是**扩展 + 补数据**，不是从零建。

### T-V1-1 归属/立场 Schema 迁移
- **改**：`prisma/schema.prisma`（迁移 M1）。
- **动作**：`npx prisma migrate dev --name add_attribution_stance` → `npm run db:generate`。
- **验收**：`ThoughtUnit.participantId/stance` 存在；`npm run type-check` 通过。

### T-V1-2 抽取产出归属+立场
- **依赖**：T-V1-1。
- **改**：
  - `src/lib/llm/prompts/argument-extraction.ts`：输出 schema 增 `speakerId`（已有）语义映射到 participant，新增 `stance` 字段（assert/oppose/question/concede/neutral）。**prompt 里说明「用窗口内已标注的说话人标签归属每个论点」**。
  - `src/lib/extraction/windowed-extraction.ts`：`windowExtractionSchema` 增 `participantLabel?: string`、`stance?: enum`；`WindowExtractionResult.thoughtUnits` 透传；`ThoughtUnitInput`（`src/types/domain.ts`）增 `participantLabel?`、`stance?`。
  - `src/lib/queue/jobs/analyze.ts`：入库 ThoughtUnit 时把 `participantLabel` 解析成 `participantId`（用该 conversation 的 participants 按 speakerLabel/name 匹配），写 `stance`。
- **成本纪律**：**并入现有窗口 pass 的同一次 `completeStructured` 调用**，不新增 LLM 调用。
- **验收**：跑一集样本，`SELECT count(*) FROM "ThoughtUnit" WHERE "participantId" IS NOT NULL` > 80% 有归属；`src/__tests__/attribution.test.ts` 断言 participantLabel→participantId 解析逻辑。

### T-V1-3 阅读器 L0 可视化（集内三视图）
- **依赖**：T-V1-2。
- **改/建**（`src/components/reader/` 或 `visualization/`，按侦察结果就近）：
  - `SpeakerTimeline.tsx`（已存在，扩展）：横向泳道，每 participant 一条，色块=Turn，宽=时长；点击 emit `onSeek(turnId)`。数据源 `/api/conversations/[id]/turns`（已有）。技术 d3-scale + Canvas。
  - `TopicRiver.tsx`（新建）：stream graph，话题随时间消长。数据源 topic 类 TU + 时间窗。技术 d3-shape `stackOffsetWiggle`。**一集数据量 Canvas 足够，不用 WebGL。**
  - `ArgumentThread.tsx`（已存在，扩展）：claim→objection/answers/refine 层级树，节点按 `participantId` 着色。数据源本集 TU + 集内 GraphEdge。
- **集成**：`src/app/read/[conversationId]/page.tsx` → `ReaderShell.tsx`：TL;DR 卡下方加「结构」折叠区，默认显示 SpeakerTimeline 缩略图，展开显示三视图 tab。
- **移动端**：泳道横向滚动；三视图在窄屏堆叠。
- **验收**：Playwright `e2e/reader-l0.spec.ts`：打开一集 → 结构区可见 → 点泳道色块 → 播放器/正文跳转到对应时间。

---

## §4 Track V2 —— 实体层 + 增量图谱 + 可视化主力（并入 C1）

**侦察命令**：
```bash
cat src/lib/graph/builder.ts | head -40; ls src/app/api/corpora/'[id]'/graph; grep -rn "cytoscape" src/components src/app; ls src/lib/embeddings
```

### T-V2-1 实体层 Schema
- **改**：`prisma/schema.prisma`（迁移 M2）→ migrate → db:generate。
- **验收**：Entity/EntityMention/CanonicalClaim/GraphNode.entityId 存在；type-check 通过。

### T-V2-2 实体抽取（并入窗口 pass）
- **依赖**：T-V2-1。
- **建**：`src/lib/llm/prompts/entity-extraction.ts` — 输入窗口文本，输出 `{ entities: [{ surfaceForm, type, canonicalGuess }] }`。
- **改**：`windowed-extraction.ts` 的 window schema 增 `entities` 数组；`extractFromWindow` 同一次调用返回（多任务结构化输出）。
- **验收**：样本集抽出 person/book/concept 实体候选，`entities.length > 0`；单集抽取 LLM 调用次数**不变**。

### T-V2-3 实体消解三级漏斗
- **依赖**：T-V2-2。
- **建**：`src/lib/entity/resolver.ts`
  ```ts
  export interface EntityCandidate { surfaceForm: string; type: string; canonicalGuess: string; embedding?: number[] }
  /** 返回已存在 Entity.id 或新建；三级：精确名 → embedding 相似(pgvector) → LLM 仲裁(批量便宜模型) */
  export async function resolveEntity(workspaceId: string, cand: EntityCandidate): Promise<{ entityId: string; created: boolean; method: 'exact'|'embedding'|'llm'|'new' }>
  export async function resolveBatch(workspaceId: string, cands: EntityCandidate[]): Promise<Map<string,string>>
  ```
  - L1 精确：`aliasesJson`/`canonicalName` 命中。
  - L2 embedding：对 canonicalGuess 取 embedding（复用 `src/lib/embeddings/client.ts`），pgvector 查同 type 最近邻，阈值（余弦 >0.86，可配）内视为同一实体。
  - L3 LLM 仲裁：候选与 Top-K 现存实体丢给便宜模型批量判「是否同一」。
- **建**：`src/lib/llm/prompts/entity-resolution.ts`（L3 仲裁 prompt，批量输入输出 `{ pairs: [{ candIdx, matchedEntityId | null }] }`）。
- **验收**：`src/__tests__/entity-resolver.test.ts`：同名合并、近义合并、异义不合并三 case；人工标注 50 对 precision ≥0.9（离线 eval 脚本 `scripts/eval-entity-resolution.ts`）。

### T-V2-4 增量子图合并（替换全量重建）
- **依赖**：T-V2-3。
- **建**：`src/lib/graph/incremental.ts`
  ```ts
  /** 单集完成后调用：抽取局部子图 → 实体消解合并节点 → set-merge 边 → 只重算受影响邻域的社区标签 */
  export async function mergeConversationIntoGraph(conversationId: string): Promise<{ nodesAdded: number; edgesAdded: number; entitiesMerged: number }>
  ```
- **改**：`src/lib/queue/jobs/analyze.ts`：把末尾的 `rebuildCorpusGraph(corpusId)` 调用替换为 `mergeConversationIntoGraph(conversationId)`。
- **保留**：`src/lib/graph/builder.ts` 的 `rebuildCorpusGraph` 作为「月度全量校准」，暴露为 `POST /api/corpora/[id]/graph`（已有 route）+ 加一个 admin 触发。
- **验收**：连续导入 3 集，图节点增量增长（不 delete 旧节点）；`src/__tests__/graph-incremental.test.ts` 断言合并后旧集节点仍在。

### T-V2-5 CanonicalClaim 观点聚类
- **依赖**：T-V2-4。
- **建**：`src/lib/graph/canonical-claim.ts`
  ```ts
  /** 对 corpus 内 claim/insight 类 TU 做语义聚类，生成/更新 CanonicalClaim（簇代表句 + 成员 + firstAssertedAt/lastAssertedAt） */
  export async function buildCanonicalClaims(corpusId: string): Promise<{ clusters: number }>
  ```
  - 用已有 embeddings 做 density-clustering（`density-clustering` 包 DBSCAN）；每簇取中心 TU 文本作代表句；`firstAssertedAt/lastAssertedAt` 来自成员 EvidenceSpan 时间戳 + Conversation.createdAt。
- **改**：L1 图谱默认展示 CanonicalClaim 而非原始 TU（密度降一个量级）。
- **验收**：轮廓系数 + 人工抽检；`buildCanonicalClaims` 幂等（重跑不炸裂已有簇）。

### T-V2-6 图谱 API 升级（结构洞察）
- **依赖**：T-V2-4/5。
- **改**：`src/app/api/corpora/[id]/graph/route.ts` GET，返回信封，`data` 增：
  ```ts
  {
    nodes, edges,                                  // 现有
    layout: { [nodeId]: { x: number; y: number } }, // 服务端 ForceAtlas2 预计算坐标
    insights: {
      clusters: { id: number; label: string; topClaimIds: string[]; size: number }[],
      bridges: { nodeId: string; betweenness: number }[],     // Top 桥接概念
      structuralGaps: { clusterA: number; clusterB: number; suggestedQuestion: string }[],
      controversies: { claimId: string; contradictCount: number }[]
    }
  }
  ```
- **建**：`src/lib/graph/analytics.ts` — 用 `graphology` + `graphology-communities-louvain`（社区）+ `graphology-metrics`（betweenness）+ `graphology-layout-forceatlas2`（坐标，服务端跑）。结构洞=两大簇间零边 → 喂便宜 LLM 生成 `suggestedQuestion`。坐标缓存进 `GraphNode.metadataJson.layout`。
- **验收**：返回含 insights；坐标稳定（同图两次请求坐标一致，走缓存）。

### T-V2-7 图谱前端（sigma.js v4 替换 Cytoscape）
- **依赖**：T-V2-6。
- **建**：`src/components/visualization/InsightGraph.tsx`
  - sigma.js + graphology；节点用后端 `layout` 坐标（`x/y` 直接 set，不在前端跑力导向）；CanonicalClaim/Entity/Participant 用 kind 着色，size ∝ betweenness。
  - 右侧 `InsightPanel.tsx`：主题聚类 Top5 / 桥接概念 / 结构洞（每条带「一键提问」→ 调 Ask）/ 争议点。
  - 交互：搜索框 typeahead → 节点高亮 + `camera.animate` fly-to；点节点 → `EvidencePopover.tsx`（原话引用+时间戳，「进阅读器」按钮）；过滤器（按说话人/集/时间染色）。
- **改**：`src/app/corpora/[corpusId]/` 图谱页换用 `InsightGraph`；旧 Cytoscape 组件标注 `@deprecated`，回归通过后（T-V2-9）删除 + `npm rm cytoscape`。
- **移动端**：图谱页提供「列表视图」等价物（聚类 + 争议点列表），键盘可导航。
- **验收**：Playwright `e2e/graph-view.spec.ts`：加载 → 洞察面板有内容 → 搜索定位节点 → 点节点弹证据 → 跳阅读器。1k 节点交互流畅（无卡顿）。

### T-V2-8 语义星图（L2）
- **依赖**：T-V2-1、embeddings 已有数据。
- **建**：
  - `src/lib/embeddings/projection.ts`：`export async function projectCorpus(corpusId): Promise<void>` — 取 corpus 全部向量 → `umap-js` 降到 2D（可选 3D）→ `density-clustering` 打簇 → 便宜 LLM 给每簇命名 → 写 `EmbeddingProjection`。worker 离线跑，零前端计算。
  - 队列 job `src/lib/queue/jobs/project.ts`：语料新增集后触发增量重投影（防抖，允许「昨日数据」）。
  - API `src/app/api/corpora/[id]/atlas/route.ts` GET → `{ points: [{ id, x, y, clusterId, clusterLabel, type, conversationId, quote }] }`。
  - `src/components/visualization/SemanticAtlas.tsx`：deck.gl `ScatterplotLayer`+`TextLayer`（簇标签），点击=证据卡；颜色按节目/说话人切换。
- **P2（不阻塞）**：deck.gl `OrbitView` 3D 漫游开关，仅作分享彩蛋。
- **验收**：星图渲染 ≥1 万点流畅；点簇标签有语义；点击点跳证据。

### T-V2-9 全局搜索（Cmd+K）
- **依赖**：无（可与 V2 并行）。
- **建**：`src/components/search/CommandPalette.tsx`（Cmd+K 唤起）——四类分组 typeahead：集 / 人物(Entity person) / 概念(Entity) / 金句(quote TU)。输入即 FTS，回车走 hybrid。
- **建**：`src/app/api/search/route.ts` GET `?q=&type=`：轻量 FTS 多表联合（Conversation/Entity/ThoughtUnit）分组返回。
- **改**：Ask（`query-stream` route 已有 SSE）加两级路由——`src/lib/rag/query-router.ts`：`export async function routeQuery(q): Promise<'local'|'global'>`（便宜 LLM 判定）；local→`hybridSearch`（已有），global→先取相关 cluster/CanonicalClaim 综述再答。ExtractionRun 记账。
- **验收**：Cmd+K 四类结果直达；Ask 对「某人某观点」走 local、对「整体怎么看 X」走 global；引用校验器（已有 `citation-verifier.ts`）仍生效。

---

## §5 Track V3 —— 人物 Skill（C4 数据闸门后）

**侦察命令**：
```bash
ls src/app/api/sources/'[id]'/claim; grep -rn "claim\|Claim" src/lib src/app/api | grep -i person; cat src/lib/rag/citation-verifier.ts | head -30
```
> `sources/[id]/claim` 认领路由已存在（v4 主播认领）；V3 复用同一套认领体系。

### T-V3-1 时间维度（E4）
- **依赖**：T-V2-5（CanonicalClaim 已有 first/lastAssertedAt）。
- **建**：`src/components/visualization/ClaimTimeline.tsx` — 某 CanonicalClaim 或某 person 的观点按发言时间排列，展示演化。数据源 CanonicalClaim 成员 TU + 时间戳。
- **验收**：给定一个跨多集的观点，时间线按年份排列成员发言。

### T-V3-2 PersonProfile 聚合
- **依赖**：M4 迁移、T-V2-3（person 实体）、T-V1-2（归属）。
- **改**：`prisma/schema.prisma`（M4）→ migrate → db:generate。Entity 加 `profile PersonProfile?`。
- **建**：`src/lib/person/profile-builder.ts`
  ```ts
  /** 按 person Entity 增量重算：统计、风格卡、关系网、综述（缓存）。<3 集则 chatEnabled=false */
  export async function buildPersonProfile(entityId: string): Promise<PersonProfile>
  ```
  - 统计：EntityMention + Conversation 聚合。
  - 风格卡 `styleJson`：口头禅（n-gram 频率）+ 常用比喻/句式（便宜 LLM 概括 该人 Turn 样本）。
  - 关系网：同台 person、supports/contradicts 最强的 person（查 GraphEdge + 归属）。
  - 综述 `summaryText`：便宜 LLM，缓存，增量失效（该人新增集时置脏）。
- **建**：`src/lib/llm/prompts/persona-style.ts`（风格卡抽取 prompt）。
- **队列**：新增集完成 → 若涉及 person 实体，enqueue profile 重算（防抖）。
- **验收**：`buildPersonProfile` 幂等；<3 集的 person `chatEnabled=false`；`src/__tests__/person-profile.test.ts`。

### T-V3-3 跨集同人识别（声纹辅助，P2）
- **依赖**：T-V3-2。
- **建**：`src/lib/transcription/voiceprint.ts` — 每集每 participant 取 3 段清晰样本 → CAM++/pyannote 段级嵌入（复用 diarizer 的 Python 侧，输出向量）→ 存 `SpeakerVoiceprint`。跨集消解时余弦匹配作强信号并入 T-V2-3 的 resolver（person 特化分支）。
- **验收**：同一人跨两集被声纹匹配合并；未报名嘉宾能靠声纹归并。

### T-V3-4 Person Hub 页（P-1，默认开放）
- **依赖**：T-V3-2。
- **建**：`src/app/person/[slug]/page.tsx` + `src/components/person/PersonHub.tsx`：人物卡（统计）/ 观点库（CanonicalClaims 按主题分组，每条带 stance+引用+时间戳+集链接，全部可回放）/ ClaimTimeline / 风格卡 / 关系网（迷你 InsightGraph）/ 金句墙（接 B1 卡片生成）。
- **API**：`src/app/api/person/[slug]/route.ts` GET → PersonProfile + 观点库 + 关系。
- **SEO**：SSG + `use cache`；`<title>{name} 的观点与访谈`；schema.org Person；OG 图复用卡片渲染器。
- **验收**：人物页可回放每条观点到原音频时间点；SEO 元数据完整；Playwright `e2e/person-hub.spec.ts`。

### T-V3-5 Persona 对话（P-2，受约束）
- **依赖**：T-V3-4。
- **建**：`src/lib/person/persona-chat.ts`
  ```ts
  /** person-scoped grounded RAG：检索限定该 participant 的 Turn+TU，引用校验器强制挂引用，检索空→拒答话术 */
  export async function personaAnswer(entityId: string, question: string): Promise<{ answer: string; citations: Citation[]; refused: boolean }>
  ```
  - 检索：`hybridSearch` 加 participant filter（该人的 TU/Turn 子集）。
  - 生成：system prompt 注入 `styleJson` + 3–5 条真实发言 few-shot（**仅措辞节奏，禁止观点外推**）。
  - 校验：复用 `src/lib/rag/citation-verifier.ts`，每段答案挂真实引用；命中为空 → 固定拒答：「TA 在已收录的 N 集中没有公开谈过这个话题」。
- **建**：`src/lib/llm/prompts/persona-chat.ts`（含红线约束：不外推、不扮演、grounded-only）。
- **API**：`src/app/api/person/[slug]/chat/route.ts`（SSE，复用 query-stream 模式）。**门槛**：`chatEnabled=false`（<3 集/敏感人物白名单）直接 403 + 说明。
- **前端**：`src/components/person/PersonaChat.tsx` — 头部常驻标识「AI 根据 {N} 集公开播客发言模拟，非本人，观点以原音频为准」；每条回答脚注引用可点跳阅读器。
- **红线（硬编码拒绝）**：声音克隆 / 视频头像 / 「用 XX 口吻骂人」类 prompt / 把对话内容当本人观点导出——全部拒绝。
- **验收**：`src/__tests__/persona-chat.test.ts`：检索空→拒答；答案必带引用；越界 prompt 被拒。拒答率落 10–30% 健康区间（离线 eval）。

### T-V3-6 认领态（P-3，接商业化）
- **依赖**：T-V3-5、现有 `sources/[id]/claim`。
- **改**：认领体系扩展到 person——`src/app/api/person/[slug]/claim/route.ts`：社媒 OAuth/邮箱域名/RSS 控制权验证 → 本人获内容修正权/对话开关/下架权/风格调教权。认领后 `PersonProfile.claimed=true`。
- **商业化钩子**：认领人物页可开付费对话/引流位（对标 Delphi 定价），与 v4 C4 主播认领合流。
- **验收**：认领后本人可切 `chatEnabled`、可下架（下架 SLA：写入即隐藏，异步清理）。

---

## §6 新增 Prompt 契约（GLM 按此写 prompt 文件，全部走 `completeStructured`）

| 文件 | 输入 | 输出 schema（Zod） | 模型档 |
|------|------|-------------------|--------|
| `argument-extraction.ts`（改） | 窗口文本（带说话人标签） | `{ arguments:[{id,text,speakerId,type,parentId,timestamp,stance}] }` | 便宜 |
| `entity-extraction.ts` | 窗口文本 | `{ entities:[{surfaceForm,type,canonicalGuess}] }` | 便宜 |
| `entity-resolution.ts` | 候选 + Top-K 现存实体 | `{ pairs:[{candIdx, matchedEntityId|null}] }` | 便宜 |
| `persona-style.ts` | 某人 Turn 样本 | `{ catchphrases[],metaphors[],sentencePatterns[],toneSummary }` | 便宜 |
| `persona-chat.ts` | 问题 + 检索命中 + 风格卡 | 流式文本 + 引用（校验器把关） | 中档 |
| `structural-gap-question.ts` | 两簇代表句 | `{ question }` | 便宜 |

> 约定：所有抽取类 prompt **并入窗口 pass 时合并为一次多任务调用**（argument+entity 同一次 `completeStructured`，schema 合并），保住成本纪律。

---

## §7 队列/Worker 接线

- 新 job 注册进 `src/lib/queue/worker.ts` + `config.ts`（复制现有 job 注册模式）：`project`（星图投影）、`person-profile`（人物重算）。
- FlowProducer（`src/lib/queue/flow.ts`）在 analyze 之后追加：`analyze → [mergeGraph(改) → canonicalClaims] → project`（并行/串行按依赖）；person-profile 由「集完成且含 person 实体」触发（防抖，避免同人多集并发重算）。
- 幂等键沿用 `sourceId+step+runId` 模式。

---

## §8 构建顺序与依赖图

```
V1: T-V1-1 → T-V1-2 → T-V1-3            (随 Phase A，先落地，最高频价值)
V2: T-V2-1 → T-V2-2 → T-V2-3 → T-V2-4 → T-V2-5 → T-V2-6 → T-V2-7
                                    └→ T-V2-8(星图，可并行)
    T-V2-9(搜索，独立可并行)
V3: T-V3-1 → T-V3-2 → (T-V3-3 P2) → T-V3-4 → T-V3-5 → T-V3-6
```
关键路径：M1→归属→（M2→实体→消解→增量合并→CanonicalClaim）→（图谱/星图/人物）。**schema 迁移（M1/M2/M4）永远先行**（晚加要回填全量重抽）。

## §9 每轨验收（冒烟）

| 轨 | 冒烟脚本 | 通过标准 |
|----|---------|---------|
| V1 | 导入 1 集 → 阅读器结构区 | 泳道/河流/论点树渲染，点击回跳，>80% TU 有归属 |
| V2 | 导入 3 集 → 图谱页 | 增量不删旧节点；洞察面板有聚类/桥接/结构洞/争议；sigma 图 1k 节点流畅；星图 1 万点流畅；Cmd+K 四类直达 |
| V3 | 一个出场≥3 集的人物 | Person Hub 可回放每条观点；Persona 对话 grounded+带引用+空则拒答；越界 prompt 被拒；认领后可下架 |

全轨通过后：删 Cytoscape 依赖；`npm run type-check` 零错误；`npm test` 绿；关键路径各留 1 条 Playwright spec。

---

## §10 明确不做（防 GLM 过度发挥）

- 不引入 Neo4j/Qdrant/GraphRAG/LightRAG/Graphiti 框架（Postgres+pgvector 覆盖，模式借鉴即可）。
- 不做 3D 知识图谱工作界面（3D 仅星图漫游彩蛋 P2）。
- 不做声音克隆/视频数字人（人格权红线）。
- 不在前端跑力导向/UMAP/聚类（全部服务端预计算）。
- 不给 <3 集人物开对话；政治等敏感人物白名单制不开对话。
- 不新建 LLM/检索封装（用现有 client / hybridSearch / citation-verifier）。

---

*Spec 版本 v1.0 | 日期 2026-07-22 | 配套 PRD：docs/prd-knowledge-presentation-2026-08.md*
