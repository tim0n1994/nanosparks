# NanoSparks 迭代方案 — 2026-07（v2）

> 状态：方案（不含实现代码）
> 基线：`docs/human-thought-infra-architecture.zh.md`（2026-06-04 愿景）+ 当前代码（Phase 0–4 大部分已落地）
> 替代范围：接替 `docs/roadmap-2026-q2.md`（其 M1–M2 内容大部分已完成或已过时）
> 作者：Claude（基于 2026-07 代码审计 + 社区实践调研）

---

## 0. 现状审计（As-Is）

### 0.1 已经落地的（比 Q2 路线图预期走得远）

| 层 | 已落地 | 证据 |
|----|--------|------|
| 领域模型 | Workspace / Corpus / Source / MediaAsset / Conversation / Participant / Turn / ThoughtUnit / EvidenceSpan / GraphNode / GraphEdge 全部建表 | `prisma/schema.prisma` |
| 感知层 | 转写 Provider 抽象（local whisper / OpenAI whisper / Deepgram 三实现 + factory）、yt-dlp 下载、YouTube + 小宇宙双 connector、文件上传 ingest | `src/lib/transcription/*`、`src/lib/xiaoyuzhou/*`、`src/lib/upload/service.ts` |
| 解释层 | 7 类 prompt（论点/说话人/话题/引语/摘要/引用/说话人姓名映射）、Episode→Conversation adapter、思想单元 + 证据锚点入库 | `src/lib/llm/prompts/*`、`src/lib/adapters/*` |
| 检索层 | pgvector(512d, HNSW) embeddings 表、OpenAI embedding client、keyword/semantic/hybrid 三模式语料问答、图谱扩展 | migration `20260424000000`、`src/lib/embeddings/*`、`/api/corpora/[id]/query` |
| 综合层 | 趋势报告（reporter）、语料图谱 API、分享链接（shareId） | `src/lib/trends/reporter.ts`、`/api/corpora/[id]/graph|trends` |
| 治理 | PII 脱敏模块（patterns + redactor）、Turn.cleanText、consent/visibility/retention 字段、prompt sanitize | `src/lib/pii/*`、`src/lib/prompt-sanitize.ts` |
| 工程 | CI（type-check + test + build）、~20 个单测文件、7 个 Playwright spec、OpenAPI 文档、i18n（中/英）、Docker Compose 四服务 | `.github/workflows/ci.yml`、`docs/openapi.yaml` |

### 0.2 关键缺口（本轮迭代的靶子）

1. **说话人分离未实现**：`whisper.ts:193` 仍是 TODO，所有 speakerId 为空 → SpeakerTimeline、participant stance、"谁说的" 全链路失血。这是产品论点（有证据链的思想结构）的最大缺口。
2. **版本基座老化整整一代**：Next 14 / React 18 / Prisma 5 / Tailwind 3 / Zod 3 / ESLint 8。社区当前基线是 Next 16（Turbopack 默认 + Cache Components + proxy.ts）、React 19.2、Prisma 7（Rust-free client）、Tailwind 4、Zod 4。拖得越久，升级成本越高（middleware→proxy、async request APIs、Prisma driver adapter 都是破坏性变更）。
3. **检索质量停在 2023 范式**：keyword 是朴素子串匹配，无 Postgres FTS、无 RRF 融合、无 reranker、无评测集。2026 生产共识是 hybrid（dense+BM25）→ RRF → cross-encoder rerank → 引用校验，且"检索失败占 RAG 失败的 ~73%"。
4. **抽取无约束、无版本、无评测**：LLM 输出靠 prompt 约定 + 事后 Zod 校验，而非 schema-constrained 生成；ThoughtUnit 有 extractionVersion 字段但没有 ExtractionRun 实体，无法安全重跑/对比两版抽取。
5. **双模型并存的技术债**：Episode/Analysis 旧世界与 Conversation/ThoughtUnit 新世界靠 adapter 桥接，写路径仍以 Episode 为主。
6. **平台缺口**：媒体存在本地文件系统（无 S3/MinIO）、Setting 表明文存 API key、无 audit log、无删除级联验证、无 LLM 可观测性（trace/成本）。
7. **工程卫生红灯**：git 仓库只有 1 个 commit，全部源码处于未跟踪状态 —— 任何一次误操作都可能损失全部工作。这是 P0。

### 0.3 结论

项目已经跨过"管线能跑通"阶段。本轮迭代的主题不是加功能，而是：**把"能出结果"升级为"结果可信、可查证、可复用"**——说话人归因、证据链完整性、检索质量、抽取可重放，四件事决定产品论点是否成立。

---

## 1. 北极星与迭代原则

北极星不变：从真实对话中抽取**可追溯**的思想结构（谁、何时、说了什么、支持/反驳了什么、证据是什么）。

本轮迭代原则：

1. **证据优先于覆盖**：宁可少抽取，不可断证据链。每个 ThoughtUnit 必须能回放到 Turn + 时间戳 + 说话人。
2. **可测量才算完成**：diarization 有 DER 数字、检索有 faithfulness/recall 数字、抽取有 golden set 对照，否则不算交付。
3. **仍然不引入 Neo4j / Qdrant / LangChain**：Postgres（pgvector + FTS）在 <1M 向量规模内是社区公认的够用边界；图先用关系表 + 应用层遍历。决策门槛沿用愿景文档 Phase 5。
4. **模型路由分级**：隐私敏感语料（consentStatus != public）默认走本地/自托管模型；公开语料走云端旗舰模型。这既是合规姿态也是成本策略。
5. **每个迭代保持 YouTube/小宇宙 demo 路径可用**（回归基线）。

---

## 2. 目标技术架构（To-Be）

```text
┌─────────────────────────────────────────────────────────────────┐
│ 前端 Next.js 16 (App Router, RSC, Turbopack, Cache Components)  │
│   /dashboard  /corpora/[id]{overview,conversations,graph,ask,   │
│   briefs}  /conversations/[id]  /share/[id]  /settings          │
└──────────────┬──────────────────────────────────────────────────┘
               │ REST(JSON envelope) + SSE(进度/流式回答)
┌──────────────▼──────────────────────────────────────────────────┐
│ API 层 (route handlers + proxy.ts 网络边界)                      │
│   auth(Clerk) · rate-limit(Redis) · zod 入参校验 · audit log     │
└──────────────┬──────────────────────────────────────────────────┘
               │ BullMQ FlowProducer（作业图，替代三段直链）
┌──────────────▼──────────────────────────────────────────────────┐
│ Worker 进程                                                      │
│  acquire → transcribe → diarize → normalize_turns →              │
│  extract(windowed) → merge → link_entities → build_relations →   │
│  embed+index → synthesize → publish                              │
│  每步幂等 · 持久状态 · 可单步重跑(ExtractionRun)                  │
└───┬───────────────┬────────────────┬────────────────────────────┘
    │               │                │
┌───▼────┐   ┌──────▼──────┐   ┌─────▼──────────────────────────┐
│Postgres│   │ Redis        │   │ 对象存储 (MinIO/S3)            │
│ 16+    │   │ BullMQ/限流/ │   │ 原始媒体·音频切片·导出产物      │
│pgvector│   │ 缓存         │   │ retention job 按策略清理        │
│ + FTS  │   └─────────────┘   └────────────────────────────────┘
└────────┘
    感知 Provider 矩阵                 解释/检索模型矩阵
  ┌────────────────────────┐        ┌────────────────────────────┐
  │ ASR: faster-whisper     │        │ LLM: Claude 5 系(云,公开)   │
  │  large-v3-turbo(本地默认)│        │      本地 GGUF/vLLM(敏感)   │
  │  Qwen3-ASR(中文候选)     │        │ Embedding: 多语模型,1024d   │
  │  Deepgram/AssemblyAI(云) │        │ Reranker: bge-reranker-v2  │
  │ Diarize: pyannote 4      │        │  -m3(本地) / 云端rerank API │
  │  community-1(exclusive)  │        │ 结构化输出: tool-use schema │
  └────────────────────────┘        └────────────────────────────┘
         可观测性：OTel traces + Langfuse(LLM) + Prometheus(队列) + pino JSON
```

架构不换血——Next/Prisma/Postgres/Redis/BullMQ 全部保留，只做代际升级和三处结构性补强：**作业图**（FlowProducer 取代硬编码三段链）、**对象存储**（媒体离开本地盘）、**评测环**（golden set + trace 进 CI）。

---

## 3. 分轨道详细方案

### Track A — 基座代际升级（先行，其余轨道都踩在它上面）

| 项 | 从 | 到 | 关键破坏性变更与对策 |
|----|----|----|----------------------|
| Next.js | 14.2 | 16.x（当前 stable 16.2 线） | ① Turbopack 成为默认 dev/build；② `middleware.ts` → `proxy.ts`（Clerk 中间件迁移，官方 codemod 覆盖）；③ Request APIs 全异步（`cookies()/headers()` 等）；④ 缓存模型反转："默认全动态、显式 `use cache` 才缓存"——对本项目有利，分析结果页天然适合 `use cache` + PPR（静态壳 + 动态流入），文档页/分享页用 `cacheLife` 长缓存 |
| React | 18.3 | 19.2 | 随 Next 16 带入；React Compiler 开启（Turbopack 内置 Rust 端口），手写 useMemo/useCallback 可逐步删除 |
| Prisma | 5.12 | 7.x | ① Rust-free TS client：需 `@prisma/adapter-pg` driver adapter；② 生成物移出 node_modules，新增 `prisma.config.ts`；③ ESM 化；④ 不再自动读 `.env`（显式加载）；⑤ pg 驱动连接池语义变化需要显式设超时。收益：客户端体积 -90%、查询提速、edge 兼容 |
| Tailwind | 3.4 | 4.x | CSS-first 配置（`@theme`），官方 upgrade 工具；顺手清理 `tailwind.config.ts` |
| Zod | 3.22 | 4.x | 性能大版本；所有 schema 定义处集中在 types + prompts，迁移面可控 |
| ESLint | 8 | 9（flat config） | Next 16 已弃用 `next lint`，改 ESLint CLI，codemod 覆盖 |
| Node | 20 | 22 LTS | Prisma 7 要求 ≥20.19，直接对齐 22；Dockerfile 同步 |

执行顺序：先 `@next/codemod upgrade`（Next+React），跑通测试；再 Prisma 7（独立 PR，回归重点是连接池/事务行为）；最后 Tailwind/Zod/ESLint。每步以"type-check 0 错误 + 全部测试绿 + Docker 构建通过"为闸门。

### Track B — 感知层：说话人分离 + ASR 矩阵（本轮最高业务价值）

**Diarization 选型（2026-07 结论）**：pyannote.audio 4.0 + **community-1** 开源管线。相对 3.1：speaker confusion 约 -50%、VBx 聚类、新增 **exclusive mode**（同一时刻只保留最可能被转写的说话人）——exclusive mode 专为对齐 Whisper 词级时间戳设计，正好消掉 WhisperX 那套复杂的对齐胶水。CC-BY-4.0，可自托管；后续如精度不够有付费 precision-2 兜底。

**管线设计**：

1. `transcribe`（词级时间戳输出）与 `diarize` 拆成两个独立 job（并行执行，都消费同一音频资产）。
2. 新增 `normalize_turns` job：合并 ASR 词序列 + diarization 说话人段 → 生成 Turn（连续同说话人段），写入 speakerLabel + confidence。现有 `speaker-mapper.ts`（LLM 说话人姓名映射）挂在其后，把 SPEAKER_00 映射到真名/角色。
3. Participant 增加人工修正回路：前端可改说话人归属，修正写回 Participant.isResolved=true，并触发下游（ThoughtUnit 归因、图谱 stance）增量修正。
4. **DER 评测**：准备 3–5 条有人工标注的中英文 fixture 音频，CI 外的 eval 脚本输出 DER/说话人计数误差；exclusive mode 与普通模式各测一次留档。

**ASR 矩阵升级**：

| 场景 | 默认 | 备选 | 理由 |
|------|------|------|------|
| 本地/敏感语料 | faster-whisper + large-v3-turbo | Qwen3-ASR（1.7B，52 语种，2026-01 发布） | turbo 体积小速度快；小宇宙中文播客占比高，Qwen3-ASR 是中文准确率候选，值得在 fixture 上对测 |
| 云端/追求准确率 | Deepgram（已有 adapter） | AssemblyAI（含 diarization，$0.17/h） | AssemblyAI 可作为"转写+分离一体"的云端逃生通道 |
| GPU 批量 | — | NVIDIA Parakeet TDT / Canary（Open ASR 榜首 5.63% WER） | 只有当自建 GPU 工作站上线后再评估（与桌面推理工作站方向天然协同） |

Provider 接口已存在，本轮只是加实现 + 加"词级时间戳"到 TranscriptResult 契约。

### Track C — 解释层 v2：受约束抽取 + 可重放

1. **Schema-constrained 结构化输出**：所有抽取调用从"prompt 里求 JSON"改为 provider 原生结构化输出（Claude tool-use / OpenAI structured outputs），Zod schema 单一事实源、按任务拆分（社区共识：一个 schema 一个任务，禁止 50 字段大杂烩 schema）。输出保证合法 JSON，Zod 校验从"防线"降级为"断言"。
2. **窗口化抽取 + 全局合并**（愿景 7.3 的落地化）：按说话人变化/时间窗切段 → per-window 抽取 ThoughtUnit（带 turnId 级证据）→ 全局 pass 做语义去重、聚类、跨窗口 supports/contradicts 连边。杜绝"整篇 transcript 一把梭"——这是论点粒度不一致的根因（Q2 路线图 5.1 已诊断，未治）。
3. **ExtractionRun 实体**（新增）：一次抽取 = 一条 run 记录（model、promptVersion、窗口参数、成本、时长、状态）。ThoughtUnit 挂 runId。收益：a) 幂等重跑（新 run 生成新集合，验收后原子切换 active run）；b) A/B 两版 prompt/模型对比；c) 语料级"用新模型全部重抽"成为一个安全批处理。
4. **模型路由**：Setting 扩展为按 workspace 的路由策略——`sensitive → local(OpenAI 兼容端点)`、`public → cloud`。现有 OpenAIClient 天然兼容本地 vLLM/llama.cpp server，只差 baseURL 配置化。
5. **抽取评测**：人工标注 20–30 段对话窗口的期望 ThoughtUnit（类型+证据），eval 脚本算类型准确率/证据锚定率，prompt 改动必须过 eval 再合并。

### Track D — 检索层 v2：混合检索 + 重排 + 评测环

对照 2026 生产基线（hybrid + RRF + rerank 已是"及格线"而非加分项）：

1. **Postgres FTS 补齐 BM25 侧**：Turn.cleanText 与 ThoughtUnit.text 建 tsvector 生成列 + GIN 索引（中文用 pg_jieba/zhparser，或退化为 bigram）。替换现在的子串 keyword 匹配。
2. **RRF 融合**：dense top-50（pgvector cosine）+ FTS top-50 → Reciprocal Rank Fusion 合并。禁止裸分数线性混合（BM25 与 cosine 值域不同，社区明确列为经典坑）。
3. **Cross-encoder 重排**：RRF 后 top-20~30 → reranker → top 5–8 进 LLM 上下文。选型：本地 bge-reranker-v2-m3（多语、免费、自托管，契合中英混合语料）；云端候选 Cohere Rerank / voyage rerank。预算 +50–200ms，可接受。
4. **图谱扩展保留但降级为第二跳**：先 hybrid+rerank 取种子 ThoughtUnit，再沿 GraphEdge 扩一跳补上下文（supports/contradicts/answers 优先）。GraphRAG 全局社区摘要那套暂不引入——社区共识是"hybrid 解决不了的关系型多跳问题才上 GraphRAG"。
5. **Embedding 升级**：512d text-embedding-3-small → 多语更强的模型（候选：text-embedding-3-large@1024d、Qwen3-Embedding（可本地）、voyage 系）。embeddings 表已有 model 列，迁移 = 新 model 全量重嵌 + 双写窗口 + 切换，走 ExtractionRun 同样的"新集合验收后切换"模式。fixture 上对测中文召回后再定型号。
6. **引用校验器**：LLM 回答里的每条 citation 反查其 evidenceSpan 是否真在检索候选集内，不在则剔除/标记。这是把 faithfulness 从 0.7 拉到 0.95 量级的社区实证手段。
7. **评测环（RAGAS 风格）**：50–100 条 golden QA（中英各半，覆盖单跳/多跳/说话人归因/时间演化四类问题），指标目标 faithfulness >0.9、context recall >0.8。检索管道任何改动跑 eval；faithfulness 掉线时先修检索不动生成。

### Track E — 综合层与产品闭环

1. **Brief 实体落地**（愿景 6.3 里唯一还没建表的核心实体）：Brief(corpusId, title, sections JSON, sourceRunIds, shareScope, createdAt)。生成入口：Corpus Graph 页选中子图 → 生成带引用 brief；Ask 页答案 → 一键存为 brief。
2. **Corpus Graph 页**（愿景 16.3 指定的第一可见功能，补完）：top claims / objections / open questions / decisions 四象限 + 参与者分布 + 每项可展开证据（时间戳跳转）。Cytoscape 保留；>1k 节点走服务端预计算布局（elk/fcose 离线跑，坐标存 GraphNode.metadataJson），前端只渲染。
3. **Ask 页流式体验**：SSE 流式回答，引用卡片随流渐进渲染，点击引用 → 右侧转录面板滚动到对应 Turn 并高亮 evidence span。
4. **Context Pack 导出**：`POST /api/corpora/:id/context-pack` 输出 agent-ready markdown/JSON（claims+evidence+引用），对齐"AI Agent 获取真实人类讨论上下文"的场景，也是与竞品差异化的钩子。
5. **Dashboard 完工**：语料卡片（对话数/处理中/失败数）、最近对话、失败作业一键重试。旧 /playlists、/submit 归并进 corpus 信息架构，Episode 路由保留只读兼容。

### Track F — 平台加固

1. **对象存储**：MinIO（自托管，S3 兼容）承接 MediaAsset。storageKey 字段已预留。retention job：每日扫描 `delete_after_*` 策略执行删除并写 audit。
2. **作业图**：BullMQ 保留（Redis 已在栈内，社区 2026 决策框架：已有 Redis 就没有理由换 pg-boss），用 FlowProducer 把 acquire→transcribe/diarize(并行)→normalize→extract→… 声明为父子作业树；每个 job 幂等（以 sourceId+step+runId 为幂等键）。
3. **AuditLog 实体**：view/export/share/delete/settings-change 五类事件，(actorId, action, resourceType, resourceId, metadata, ts)。
4. **删除级联验证**：集成测试制造一个全链路 source（媒体+转录+TU+边+embedding+brief+share），删除后断言各表零残留 + 对象存储清空。这是愿景 Phase 4 的退出标准，目前无测试背书。
5. **Secrets**：Setting 表中的 API key 改为 AES-GCM 加密存储（主密钥走环境变量/Keychain）；`.env` 落实 `.env.example` 对齐 + gitignore 复核（当前 `.env` 未被忽略，见 git status —— 与 secrets 审计一起在 I0 处理）。
6. **可观测性**：pino JSON 日志统一；OTel trace 贯穿 API→queue→LLM 调用；Langfuse（自托管）记录每次 LLM 调用的 prompt/成本/时延，语料级成本汇总进 dashboard；BullMQ 指标（等待/失败/时延）暴露 Prometheus 格式给 `/api/health/worker`。
7. **限流**：内存 Map → Redis INCR+EXPIRE（Q2 计划 P0 项，尚未迁移完成的话此轮必须收口）。

---

## 4. 数据模型增量（DDL 级别描述，不写代码）

新增实体：

| 实体 | 关键字段 | 说明 |
|------|---------|------|
| ExtractionRun | id, conversationId/corpusId, kind(extract/embed/graph), model, promptVersion, params, status, costUsd, startedAt, finishedAt, isActive | 抽取/嵌入/建图的可重放执行记录 |
| Brief | id, corpusId, title, sectionsJson, sourceRunId, shareId, visibility, createdAt | 综合层一等公民 |
| AuditLog | id, workspaceId, actorId, action, resourceType, resourceId, metadataJson, createdAt | 治理 |
| SpeakerProfile（可选，I5 再定） | id, workspaceId, displayName, aliasesJson | 跨对话同一人识别（Participant.externalId 指向它） |

变更：

- Turn：+ tsvector 生成列（cleanText 优先）；+ wordsJson（词级时间戳，供 evidence 精确高亮）。
- ThoughtUnit：+ runId（FK ExtractionRun）；+ tsvector 列。
- embeddings：维度迁移策略见 Track D.5（model 列已支持多代共存）。
- Episode/Analysis：冻结为只读遗留（不再新增写路径），backfill 脚本已有；物理删除留到 v3。

---

## 5. API Surface 增量（在 openapi.yaml 上扩展）

统一约定：envelope `{ success, data, error, meta }`（现有规范延续）；错误码字典化；所有列表接口带 cursor 分页；写接口全部要求 Clerk auth + Redis 限流 + zod 校验 + audit。

| Endpoint | 方法 | 说明 |
|----------|------|------|
| `/api/sources/:id/stream` | GET (SSE) | 处理进度实时推送（替代轮询 status；事件=作业图节点状态变迁） |
| `/api/conversations/:id/turns` | GET | 分页转录 + 说话人 + evidence 锚点 |
| `/api/conversations/:id/participants/:pid` | PATCH | 人工修正说话人归属（触发下游增量修正） |
| `/api/conversations/:id/reextract` | POST | 创建新 ExtractionRun（body: model, promptVersion） |
| `/api/corpora/:id/query` | POST | 升级：mode 默认 hybrid+rerank；SSE 流式返回 + 渐进引用 |
| `/api/corpora/:id/briefs` | POST/GET | 生成/列出 brief |
| `/api/briefs/:id` | GET/PATCH/DELETE | brief 详情/编辑/删除（share 走现有 shareId 机制） |
| `/api/corpora/:id/context-pack` | POST | agent-ready 上下文包导出 |
| `/api/corpora/:id/runs` | GET | 抽取/嵌入 run 历史与成本 |
| `/api/health/worker` | GET | 队列深度/失败率/worker 心跳（Prometheus 兼容） |
| `/api/audit` | GET | workspace 审计日志（分页+过滤） |

---

## 6. 前端方案要点

- **渲染策略**（Next 16 新缓存模型）：全站默认动态；`/docs`、`/share/[id]` 用 `use cache` + 长 cacheLife；语料/对话页用 PPR——壳（导航+骨架）静态、数据流式；分析完成时用 `updateTag/revalidateTag` 精准失效。
- **状态管理**：服务端状态一律 RSC + TanStack Query v5（轮询→SSE 订阅封装成 hook）；客户端全局状态仅剩 UI 偏好（语言/主题/面板布局），用现有 React context 足够，不引 Zustand（Q2 遗留待决项就此关闭）。
- **可视化性能**：Cytoscape 保留；布局服务端预计算；>3k 节点先做 LOD（聚类折叠）而不是换 WebGL 库；时间线 D3 点击跳转原媒体秒级定位（YouTube embed seek / 音频 player seek）。
- **可访问性与移动端**：图谱页提供列表视图等价物（four-quadrant 列表天然充当）；键盘导航引用跳转。
- **组件层**：现有手写 ui 组件规模尚小，不强推 shadcn/ui；Tailwind 4 迁移时统一 design tokens 进 `@theme`。

---

## 7. 质量体系

| 层 | 手段 | 目标 |
|----|------|------|
| 单测 | Vitest（现有 ~20 文件基础上补 queue 作业图、RRF 融合、引用校验器、加密存储） | 覆盖率 80%（现有 vitest 阈值已设） |
| 集成 | 删除级联全链路测试、fixture 音频端到端管线测试（mock LLM，真 ASR 小模型） | 每 PR 跑 |
| E2E | Playwright 7 spec 扩展：submit→进度 SSE→graph 页→ask→brief→share | 主路径全覆盖 |
| ASR/Diarize eval | fixture 集 WER/DER 脚本（离线，nightly） | DER 出数、模型选型有据 |
| 抽取 eval | 20–30 窗口 golden 标注，类型准确率/证据锚定率 | prompt 改动闸门 |
| RAG eval | 50–100 golden QA，faithfulness >0.9 / recall >0.8 | 检索改动闸门 |
| 观测 | Langfuse trace + 成本仪表 + 队列 Prometheus | 单对话成本可见 |

---

## 8. 里程碑（双周节奏，约 12 周）

| 迭代 | 主题 | 关键交付 | 退出标准 |
|------|------|---------|---------|
| **I0**（第 0 周，2–3 天） | 工程卫生急救 | git 全量基线提交 + 分支策略；`.env` 出库/轮换密钥；`.gitignore` 收口（.next/test-results/.DS_Store）；CI 加 npm audit | 仓库可回滚；无明文密钥入库 |
| **I1**（1–2 周） | 基座代际升级 | Next 16 + React 19 + proxy.ts + Prisma 7 + Tailwind 4 + Zod 4 + ESLint 9 + Node 22 | type-check 0 错、全测试绿、Turbopack 构建、Docker 通 |
| **I2**（3–4 周） | 说话人分离 + ASR 矩阵 | pyannote community-1 exclusive mode、词级时间戳、normalize_turns、人工修正回路、DER eval 脚本 | fixture DER 出数；SpeakerTimeline 渲染真实数据；修正回路可用 |
| **I3**（5–6 周） | 解释层 v2 | 结构化输出改造、窗口化抽取+全局合并、ExtractionRun、模型路由（敏感→本地） | 重跑抽取不产生脏数据；抽取 eval 过线；两版 run 可对比 |
| **I4**（7–8 周） | 检索层 v2 | FTS+RRF+bge 重排、引用校验器、embedding 升级迁移、golden QA eval 环 | faithfulness >0.9；中文查询召回明显改善（eval 佐证） |
| **I5**（9–10 周） | 产品闭环 | Corpus Graph 页、Ask 流式引用、Brief 实体+builder、Context Pack、Dashboard 完工 | 演示路径：导入 5 条播客 → 图谱 → 提问 → brief → 分享，全程无手工干预 |
| **I6**（11–12 周） | 平台加固 | MinIO、FlowProducer 作业图、AuditLog、删除级联测试、Setting 加密、Langfuse/OTel、Redis 限流收口 | 删除级联零残留测试绿；成本/队列仪表可看；安全清单过审 |

依赖关系：I1 → 全部；I2 → I3（Turn 归因是抽取输入）；I3 → I4（TU 质量决定检索上限）；I2–I4 → I5。I0 与 I6 部分项（限流、加密）可穿插提前。

---

## 9. 决策记录（本轮 ADR 摘要）

| # | 决策 | 理由 | 重新评估条件 |
|---|------|------|--------------|
| 1 | 升 Next 16 而非停留 14 | 14 已落后两个大版本；proxy.ts/async API 变更越拖越贵；Cache Components 与本产品"重分析结果页"高度契合 | — |
| 2 | Diarization 选 pyannote 4 community-1（不用 WhisperX 整包） | exclusive mode 原生解决 Whisper 对齐；-50% speaker confusion；自托管免费 | DER 不达标 → precision-2 或 AssemblyAI |
| 3 | 队列保留 BullMQ（不换 pg-boss/Inngest） | Redis 已在栈内；吞吐余量大；FlowProducer 满足作业图需求 | 若未来去 Redis 化再议 |
| 4 | 检索 = pgvector + Postgres FTS + RRF + 本地 reranker | <1M 向量规模 Postgres 够用；RRF+rerank 是 2026 生产及格线；不加新基础设施 | 向量 >1M 或过滤延迟超标 → Qdrant |
| 5 | 不引入 Microsoft GraphRAG / LightRAG 框架 | 自有 schema 化图（TU+GraphEdge）已覆盖"关系扩展"需求；框架锁定成本高 | 多跳全局问题 eval 持续不及格 |
| 6 | 抽取走 provider 原生结构化输出 + Zod 单一事实源 | token 级 schema 约束把解析失败从概率问题变成断言 | — |
| 7 | Embedding 换多语模型（fixture 对测后定型号） | 中文语料占比高，512d small 是 M0 权宜 | — |
| 8 | Episode 模型冻结只读，不做物理迁移 | 概念重命名已完成，物理删除收益低风险高 | v3 清理窗口 |
| 9 | LLM 缓存从进程内 Map 迁到 Redis（随 I3） | 多实例/重启失效；与限流同一基础设施 | — |

---

## 10. 风险矩阵

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| Prisma 7 driver adapter 行为差异（连接池/SSL/事务） | 中 | 高 | 独立 PR + 集成测试重点回归；连接池参数显式化 |
| pyannote 中文/嘈杂播客 DER 不达标 | 中 | 高 | fixture 先行评测再全量；云端 AssemblyAI 逃生通道 |
| Next 16 缓存模型迁移引入性能回退 | 中 | 中 | 先全动态跑通，再逐页加 `use cache`；prod 模式压测 |
| 窗口化抽取成本上升（调用次数×窗口数） | 高 | 中 | 窗口去重缓存、并发预算、模型路由（便宜模型做窗口级、旗舰做合并级） |
| 中文 FTS 分词质量（pg_jieba 运维成本） | 中 | 中 | 先 bigram 兜底，eval 数据说话 |
| 单人带宽被 7 条轨道摊薄 | 高 | 高 | 严格按 I0→I6 串行主线，Track F 只做 I6 列明项，其余进 backlog |
| Embedding/抽取全量重跑成本 | 中 | 中 | ExtractionRun 增量重跑 + 语料级分批 |

---

## 11. 参考来源（2026-07 调研）

- Next.js 16 / Cache Components / Turbopack：[nextjs.org/blog/next-16](https://nextjs.org/blog/next-16)、[升级指南](https://nextjs.org/docs/app/guides/upgrading/version-16)、[Next.js 16.1](https://nextjs.org/blog/next-16-1)、[16.3 Turbopack](https://nextjs.org/blog/next-16-3-turbopack)
- Prisma 7（Rust-free）：[官方发布](https://www.prisma.io/blog/announcing-prisma-orm-7-0-0)、[v7 升级指南](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7)、[InfoQ 分析](https://www.infoq.com/news/2026/01/prisma-7-performance/)
- pyannote 4.0 + community-1：[发布博客](https://www.pyannote.ai/blog/community-1)、[GitHub releases](https://github.com/pyannote/pyannote-audio/releases)、[HF 模型卡](https://huggingface.co/pyannote/speaker-diarization-community-1)
- Diarization 横评：[AssemblyAI Top 8](https://www.assemblyai.com/blog/top-speaker-diarization-libraries-and-apis)、[BrassTranscripts 对比](https://brasstranscripts.com/blog/speaker-diarization-models-comparison)
- ASR 2026 现状：[Northflank 开源 STT 基准](https://northflank.com/blog/best-open-source-speech-to-text-stt-model-in-2026-benchmarks)、[Gladia 开源模型盘点](https://www.gladia.io/blog/best-open-source-speech-to-text-models)
- RAG 生产实践：[RAG in Production 2026](https://ailearningguides.com/rag-production-patterns-2026/)、[Hybrid Search + Reranking](https://towardsdatascience.com/hybrid-search-and-re-ranking-in-production-rag/)、[BM25+pgvector RRF](https://dev.to/gabrielanhaia/hybrid-search-in-100-lines-bm25-pgvector-with-rrf-merge-58cn)、[Enterprise RAG Architecture](https://www.applied-ai.com/briefings/enterprise-rag-architecture/)
- 结构化输出：[Structured Outputs in 2026](https://app.daily.dev/posts/structured-outputs-in-2026-a-developer-guide-4qqi5lmpc)、[Schema Validation for Real Pipelines](https://collinwilkins.com/articles/structured-output)
- 队列选型：[BullMQ vs pg-boss 2026](https://www.pkgpulse.com/guides/bullmq-vs-bee-queue-vs-pg-boss-job-queues-nodejs-2026)

---

*方案版本: v2.0 | 日期: 2026-07-13 | 下次回顾: I3 结束时*
