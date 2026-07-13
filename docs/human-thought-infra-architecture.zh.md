# NanoSparks 人类思想基础设施架构设计

> 日期：2026-06-04
> 状态：设计提案
> 替代范围：仅替代 `docs/architecture-review.md` 里的产品叙事。当前代码仍然是实施基线。

## 1. 北极星

NanoSparks 不应该只被理解为“把 YouTube 播客变成知识图谱”的工具。它更大的方向是：从真实的人与人交流中抽取高价值情报、知识、观点和决策上下文，并沉淀成可查询、可组合、可复用的人类思想表征。

项目最初的产品形态是：

```text
YouTube 播客 -> 转录文本 -> LLM 分析 -> 互动式观点地图
```

新的产品形态应该是：

```text
任何对话音视频/文本 -> 有证据锚点的转录 -> 思想单元 -> 洞察图谱 -> 可复用上下文
```

这里最关键的抽象不是 `Episode`，而是 `Conversation`：一段有边界的人类交流，其中会出现观点、反驳、证据、问题、决策、共识、分歧和隐性知识。

长期来看，系统应该支持以下来源：

- 公开媒体：YouTube 视频、播客、RSS、访谈、直播回放。
- 工作媒体：Zoom、Google Meet、Microsoft Teams、销售电话、用户访谈、研究访谈。
- 本地媒体：上传的音频、视频、电话录音、线下会议录音。
- 派生文本：已有转录、会议纪要、聊天记录、访谈笔记、导入的研究文档。

这个项目真正要沉淀的资产不是“转录文本”，而是带时间、来源、说话人和证据链的人类思想结构。

## 2. 市场调研结论

### 2.1 产品类别

| 类别 | 代表工具 | 它们证明了什么 | NanoSparks 可以拥有的空间 |
| --- | --- | --- | --- |
| 收入对话智能 | Gong | 企业愿意为绑定业务结果的对话图谱付费。Gong 强调捕获所有客户互动、收入图谱、专用 Agent 和工作流自动化。 | Gong 强绑定销售和 GTM。NanoSparks 可以做更通用、更偏思想结构的对话智能。 |
| AI 会议记忆 | Fireflies、Read AI、Granola、Fathom、tl;dv | 市场已经从“转录”转向“可搜索会议记忆”、跨会议洞察、行动项和 AI 集成。 | 这些工具主要优化纪要、任务、CRM 更新和摘要，很少深入建模论证结构。 |
| 研究资料库 / 客户情报 | Dovetail、Condens、Looppanel | 高价值工作流不是单次通话摘要，而是跨大量对话的、有证据支撑的综合分析。 | 它们聚焦用户研究。NanoSparks 可以泛化到辩论、专家访谈、战略讨论、播客和私下交流。 |
| 播客知识工具 | Podwise、Snipd、NotebookLM | 用户需要从长音频里获得思维导图、问答、导出和回忆能力。 | 现有工具更偏摘要和个人知识管理。NanoSparks 应强调关系化思想图谱。 |
| 协商与论证地图 | Polis、Kialo、Argdown | 结构化观点空间和论证地图是表达群体思想的成熟形式。 | 这些系统通常需要用户主动输入结构。NanoSparks 可以从原始对话中推断结构。 |
| 语音 AI 基础设施 | Deepgram、AssemblyAI、Speechmatics、Recall.ai | 语音转文本、说话人分离、实时流、会议捕获和合规能力已经基础设施化。 | NanoSparks 不应该竞争底层语音识别，而应该集成和切换这些能力。 |
| AI 记忆 / 向量 / 图数据库 | Qdrant、Chroma、Neo4j、Mem0、GraphRAG、LightRAG | 混合搜索、图结构、时间记忆和实体链接正在成为标准基础设施。 | NanoSparks 需要在这些基础能力之上建立 conversation-native schema。 |

### 2.2 直接教训

1. 转录不是护城河。
   Deepgram、AssemblyAI、Speechmatics、Whisper、WhisperX、pyannote 和 Recall.ai 已经很好地覆盖这一层。

2. 真正的产品单位是语料集，不是单条录音。
   Dovetail、Gong、Fireflies、Read AI 和 tl;dv 都在走向跨对话搜索、趋势、摘要和自动行动。

3. 来源证据必须是一等公民。
   每一个抽取出来的洞察都必须能回到源媒体、时间戳、说话人、置信度和生成它的原始语句。

4. 长期差异化来自结构化抽取。
   NanoSparks 应该建模 claim、question、objection、evidence、assumption、decision、tension、open loop 和概念依赖关系。

5. 隐私不是附加功能，而是产品架构。
   真实对话包含敏感私密数据。授权、保留策略、脱敏、访问边界和源删除必须从 M0 开始设计。

## 3. 产品论点

NanoSparks 是一套人类智能蒸馏系统。

它监听真实交流，并构建一套可复用、可查询的思想表征，回答以下问题：

- 说了什么；
- 谁说的；
- 表达了什么观点；
- 支持或反驳了什么；
- 依据是什么；
- 观点如何随时间变化；
- 这个群体似乎知道什么；
- 仍然不确定什么。

这让系统可以服务于：

- 创始人从客户访谈中抽取市场信号；
- 研究者综合大量访谈材料；
- 投资人跟踪专家访谈和尽调讨论；
- 团队保留决策上下文；
- 作者和分析师挖掘播客、访谈和公开对话；
- 社群理解集体意见结构；
- AI Agent 获取来自真实人类讨论的高信号上下文。

## 4. 架构原则

1. 对话优先。
   YouTube、会议、上传文件和转录文本都只是输入适配器。核心领域模型从 `Conversation` 开始。

2. 保留原始证据。
   必须存储原始媒体元数据、转录片段、说话人轮次和抽取来源。系统不能只存摘要。

3. 感知层和解释层分离。
   语音识别、说话人分离、OCR 和元数据抽取产生的是观察结果。LLM 产生的是解释结果。两者必须分开存储。

4. 分层构建智能。
   不要从转录文本直接跳到最终报告。先抽取小的类型化思想单元，再派生上层图谱和简报。

5. M0 保持朴素。
   当前 Next.js、Prisma、Postgres、Redis、BullMQ、Whisper、Cytoscape 和 D3 足够支撑第一次迁移。只有当查询模式证明需要时，再引入 Qdrant 或 Neo4j。

6. 把删除视为图操作。
   删除一个源必须删除或失效所有派生 embedding、思想单元、图边、简报、导出和缓存结果。

## 5. 目标系统总览

```text
                    +----------------------+
                    |    Source Connectors |
                    | upload / YouTube /   |
                    | RSS / meeting API /  |
                    | local recorder       |
                    +----------+-----------+
                               |
                               v
                    +----------------------+
                    |   Ingestion Ledger   |
                    | source, consent,     |
                    | ownership, status    |
                    +----------+-----------+
                               |
                               v
+----------------+   +----------------------+   +------------------+
| Object Storage |<--|   Media Processing   |-->| Transcript Store |
| raw media      |   | STT, diarization,    |   | turns, words,    |
| thumbnails     |   | OCR, metadata        |   | timestamps       |
+----------------+   +----------+-----------+   +------------------+
                               |
                               v
                    +----------------------+
                    | Thought Extraction   |
                    | claims, questions,   |
                    | objections, etc.     |
                    +----------+-----------+
                               |
                               v
                    +----------------------+
                    |    Insight Graph     |
                    | entities, topics,    |
                    | stances, relations   |
                    +----------+-----------+
                               |
             +-----------------+-----------------+
             v                                   v
  +----------------------+            +----------------------+
  | Retrieval Interfaces |            | Synthesis Interfaces |
  | search, ask, compare |            | briefs, maps, clips, |
  | graph traversal      |            | exports, agent ctx   |
  +----------------------+            +----------------------+
```

## 6. 核心领域模型

### 6.1 当前模型问题

当前 schema 更接近：

```text
Channel -> Episode -> Analysis -> ReferenceLink
Playlist -> PlaylistEpisode
```

它适合 YouTube 产品，但不适合作为通用对话智能系统的底层模型。

### 6.2 建议模型

```text
Workspace
  |
  +-- Corpus
        |
        +-- Source
        |     |
        |     +-- MediaAsset
        |     +-- Transcript
        |
        +-- Conversation
              |
              +-- Participant
              +-- Turn
              |     |
              |     +-- Utterance
              |
              +-- ThoughtUnit
              |     |
              |     +-- EvidenceSpan
              |
              +-- InsightGraph
                    |
                    +-- GraphNode
                    +-- GraphEdge
                    +-- IntelligenceBrief
```

### 6.3 实体定义

| 实体 | 含义 |
| --- | --- |
| `Workspace` | 所有权和权限边界，对应 Clerk 中的 user 或 org。 |
| `Corpus` | 为某个目的组织的一组对话，例如客户发现、AI 安全播客、投资尽调、团队决策。 |
| `Source` | 原始输入引用，例如 YouTube URL、上传文件、Zoom 会议、转录文件、RSS 条目。 |
| `MediaAsset` | 存储后的音频、视频、图片或文件元数据，以及对象存储 key。 |
| `Conversation` | 一段有边界的交流。一个 source 可以产生一个或多个 conversation。 |
| `Participant` | 对话中的人或角色身份，可以已知、匿名或尚未解析。 |
| `Turn` | 连续的说话人片段，带时间戳。 |
| `Utterance` | Turn 内更小的文本片段，用于证据锚定。 |
| `ThoughtUnit` | 抽取出的语义单元，例如观点、问题、证据、反驳、决策、假设、风险、例子、定义、预测、偏好。 |
| `EvidenceSpan` | ThoughtUnit 对应的精确转录或媒体来源证据。 |
| `GraphNode` | 规范化后的实体、概念、观点簇、主题、参与者、产物、决策或未解决问题。 |
| `GraphEdge` | 类型化关系，例如 supports、contradicts、refines、depends_on、answers、cites、exemplifies、raised_by、agreed_by、disputed_by。 |
| `IntelligenceBrief` | 基于图谱和证据生成的可读输出。 |

### 6.4 思想单元分类

M0 只需要支持能证明产品价值的最小类型：

```text
claim       可被验证或争论的断言。
question    显式或隐式的信息需求。
evidence    事实、例子、引用、指标、轶事或观察。
objection   对观点、计划、前提或证据的挑战。
decision    已解决的选择、承诺或共识。
risk        负面结果、不确定性、阻塞或失败模式。
insight     从多个语句中综合出的高价值模式。
```

后续可以扩展：

```text
assumption, definition, prediction, preference, emotion, value, tradeoff,
action_item, contradiction, analogy, principle, strategy, open_loop
```

## 7. 处理流水线

### 7.1 Job 图

当前三阶段 pipeline 应该演进为阶段图。BullMQ 仍然可以继续承担执行层。

```text
ingest_source
  -> fetch_metadata
  -> acquire_media
  -> transcribe_media
  -> diarize_speakers
  -> normalize_turns
  -> extract_thought_units
  -> link_entities
  -> build_relations
  -> index_retrieval
  -> synthesize_briefs
  -> publish_artifacts
```

每个 job 都必须写入持久状态，并且可以安全重试。幂等性要求同一个 job 执行两次时不会重复创建图节点，也不会破坏派生结果。

### 7.2 感知层

输入：

- 音频或视频字节；
- 已有转录；
- 会议 API 转录；
- YouTube 元数据；
- 聊天栏或侧边栏日志；
- 日历元数据；
- 可用的说话人元数据。

输出：

- 标准化转录；
- 词级或片段级时间戳；
- 说话人标签；
- 置信度；
- 语言检测；
- 媒体片段；
- 隐私脱敏标记。

Provider 策略：

```text
local:   Whisper + WhisperX + pyannote，用于自托管和成本控制
cloud:   Deepgram / AssemblyAI / Speechmatics，用于实时或企业级准确率
meeting: Recall.ai，用于需要精确参与者音轨的会议捕获
```

### 7.3 解释层

解释层应该小窗口抽取，然后全局合并。

```text
Transcript turns
  |
  +-- 按时间 / 主题 / 说话人变化切窗口
        |
        +-- 抽取 thought units
        +-- 抽取 entities 和 concepts
        +-- 抽取局部关系
        +-- 分配 confidence 和 evidence spans
  |
  +-- 全局合并
        |
        +-- 对语义等价单元去重
        +-- 聚类观点和主题
        +-- 链接支持 / 反驳 / 修正关系
        +-- 检测未解决问题和决策
```

不要让 LLM 一次性生成一个巨大摘要。应该要求它输出类型化、带证据的 JSON 记录。

### 7.4 综合层

综合结果应该从图谱生成，而不是直接从原始转录生成。

输出包括：

- conversation map；
- argument map；
- timeline；
- participant stance map；
- decision log；
- open questions；
- high-signal quotes；
- cross-conversation trend report；
- agent-ready context pack。

## 8. 存储架构

### 8.1 M0 存储

Postgres 继续作为 system of record。

M0 推荐：

- Postgres + Prisma 存储所有规范数据。
- 如果部署环境支持，可以选择 `pgvector` 存 embedding。
- Redis + BullMQ 运行任务。
- 本地文件系统或 S3 兼容存储保存媒体。

M0 阶段不要急着引入 Neo4j 或 Qdrant，除非某个具体功能已经需要。图结构可以先用关系表表达。

### 8.2 M1 存储

当查询压力真实出现时，再加入专用存储：

| 需求 | 存储 |
| --- | --- |
| 对 utterance 和 thought unit 做语义搜索 | Qdrant 或 pgvector |
| 带 payload filter 的混合搜索 | Qdrant |
| 深度图遍历和图算法 | Neo4j |
| 快速原型化本地向量搜索 | Chroma |
| Agent 记忆和时间事实回忆 | Mem0-like memory layer 或内部等价实现 |

### 8.3 关系型图表

```text
thought_units
  id
  conversation_id
  type
  canonical_text
  confidence
  created_by_model
  extraction_version

evidence_spans
  id
  thought_unit_id
  utterance_id
  start_ms
  end_ms
  quote

graph_nodes
  id
  corpus_id
  kind
  label
  canonical_text
  metadata_json

graph_edges
  id
  corpus_id
  source_node_id
  target_node_id
  relation
  confidence
  evidence_json
```

## 9. 检索与问答架构

查询栈应该组合：

```text
keyword search + semantic search + graph traversal + temporal filters + provenance
```

典型问题：

- “客户电话里反复出现了哪些反对意见？”
- “Alice 提出的哪些观点后来被 Bob 挑战？”
- “第 1 期到第 8 期之间观点发生了什么变化？”
- “展示这个洞察的证据。”
- “做出这个决策前还有哪些假设没有解决？”
- “为正在实现这个功能的 AI Agent 生成一份上下文包。”

检索流程：

1. 解析查询意图。
2. 按 workspace、corpus、source type、时间范围、参与者和隐私标签过滤。
3. 检索候选 utterance 和 thought unit。
4. 沿 graph edge 扩展上下文。
5. 按证据强度、时效性、来源多样性和置信度排序。
6. 生成带 evidence span 引用的回答。

## 10. 隐私、授权与治理

对话数据是高风险数据。架构必须从一开始纳入治理能力。

M0 要求：

- `Source.consentStatus`：unknown、granted、denied、public、imported_by_owner。
- `Source.visibility`：private、workspace、shared_link、public。
- `MediaAsset.retentionPolicy`：keep、delete_after_processing、delete_after_days。
- 在广泛共享或导出前运行 PII 脱敏 job。
- 删除级联覆盖 media、transcripts、embeddings、thought units、graph edges、briefs。
- 对 view、export、share、delete 记录 audit log。

M1 要求：

- participant-level privacy labels；
- 会议捕获的 consent receipts；
- workspace-level data training policy；
- per-corpus retention settings；
- 企业 legal hold mode。

## 11. API Surface

M0 endpoint 可以贴近当前应用：

```text
POST /api/sources
GET  /api/sources/:id
GET  /api/sources/:id/status

POST /api/conversations
GET  /api/conversations/:id
GET  /api/conversations/:id/full

GET  /api/corpora/:id/graph
POST /api/corpora/:id/query
POST /api/corpora/:id/briefs
```

创建 source 的 payload：

```json
{
  "kind": "youtube_url | media_upload | transcript_upload | meeting_import",
  "uri": "string",
  "corpusId": "string",
  "consentStatus": "public | granted | imported_by_owner | unknown",
  "retentionPolicy": "keep | delete_after_processing"
}
```

## 12. 前端信息架构

当前 `/visualization/[episodeId]` 应该成为更大 workspace 里的一个视图。

推荐导航：

```text
Workspace
  |
  +-- Corpora
  |     +-- Corpus overview
  |     +-- Conversations
  |     +-- Graph
  |     +-- Search / Ask
  |     +-- Briefs
  |
  +-- Sources
  |     +-- Upload / import
  |     +-- Processing status
  |
  +-- Settings
        +-- privacy
        +-- retention
        +-- connectors
```

关键视图：

- Conversation view：转录、说话人轮次、片段、抽取出的 thought units。
- Map view：观点、主题、说话人、证据和反驳构成的图。
- Corpus intelligence view：反复出现的主题、矛盾、决策和未解决问题。
- Brief builder：从选中的图谱区域生成可分享输出。

## 13. 从当前代码迁移

### 13.1 保留

- Next.js App Router。
- Prisma/Postgres。
- Redis/BullMQ。
- 当前 worker factory。
- YouTube parser/downloader 作为第一个 connector。
- Whisper script 作为第一个 transcription provider。
- Cytoscape/D3 可视化组件作为第一版 graph UI。
- 当前测试作为回归基线。

### 13.2 先做概念重命名，后做物理重命名

不要在一个 PR 里重命名所有东西。先通过兼容 alias 过渡。

```text
Episode       -> Conversation
Playlist      -> Corpus
Analysis      -> ConversationAnalysis / InsightGraph
Argument      -> ThoughtUnit(type=claim/objection/evidence)
ReferenceLink -> ExternalReference / EvidenceLink
```

### 13.3 第一次 schema 扩展

在现有模型旁边新增：

```text
Source
Corpus
Conversation
Participant
Turn
ThoughtUnit
EvidenceSpan
GraphNode
GraphEdge
Brief
```

然后把现有 YouTube `Episode` 行 backfill 到新模型。新 UI 准备好之前，保持当前 route 继续可用。

## 14. 分阶段实施计划

### Phase 0：不破坏现有产品的前提下重塑概念

目标：保持 YouTube demo 可用，同时引入新的词汇和存储层。

交付物：

- 加入本架构文档。
- 添加 `Source`、`Corpus`、`Conversation`、`Participant`、`Turn` Prisma 模型。
- 添加把当前 `Episode` 映射到 `Conversation` 的 adapter。
- 为现有 ingest 增加 `sourceType=youtube` 路径。

退出标准：

- 现有 YouTube submit 和 visualization 仍然可用。
- 每个处理完成的 episode 都有一个新的 conversation record。

### Phase 1：带证据锚点的 Thought Units

目标：用类型化抽取记录替代松散 JSON analysis。

交付物：

- 添加 `ThoughtUnit` 和 `EvidenceSpan`。
- 重构 LLM prompt，让输出带 evidence span ID 的类型化单元。
- 为所有模型输出添加 Zod validation。
- 更新可视化，从标准化表渲染 thought units。

退出标准：

- 每个 claim、objection、evidence 都能链接到带时间戳的源文本。
- 错误 LLM JSON 能优雅失败并可重试。

### Phase 2：多来源对话导入

目标：扩展到 YouTube 之外。

交付物：

- 文件上传 ingest。
- 转录上传 ingest。
- 会议导入抽象。
- transcription provider interface：

```typescript
interface TranscriptionProvider {
  transcribe(input: MediaAsset): Promise<TranscriptResult>;
}
```

- 可选 Deepgram、AssemblyAI 或 Speechmatics adapter。
- 评估 Recall.ai，用于需要参与者级音轨的会议捕获。

退出标准：

- 同一条分析 pipeline 可以处理 YouTube、上传媒体和转录导入。

### Phase 3：Corpus-Level Insight Graph

目标：支持跨大量对话的情报抽取。

交付物：

- 添加 `GraphNode` 和 `GraphEdge`。
- 在 corpus 内对 thought units 去重和聚类。
- 添加 corpus graph API。
- 添加带引用的 corpus QA。
- 添加第一版趋势报告：重复观点、反对意见、决策、未解决问题。

退出标准：

- 用户可以跨多个 conversation 提问，并检查引用证据。

### Phase 4：隐私与共享加固

目标：让私密对话数据达到严肃使用场景的安全门槛。

交付物：

- API 强制 consent 和 retention 字段。
- 删除级联测试。
- 脱敏 job。
- Audit log。
- 带 scoped visibility 的 shared brief links。

退出标准：

- 删除 source 会移除所有派生产物。
- 共享输出不会暴露 scope 外的私密 transcript spans。

### Phase 5：专用基础设施

目标：只有当真实产品查询模式出现后，再加入专用存储。

决策门槛：

- 如果语义搜索延迟或过滤能力超过 Postgres/pgvector 的边界，再加 Qdrant。
- 如果图遍历成为核心能力，且关系型查询变得痛苦，再加 Neo4j。
- 如果 Agent 需要低 token、跨 session 的时间记忆，再加 Mem0-like memory layer。

退出标准：

- 每个新基础设施都有可测量瓶颈、迁移计划、回滚计划和本地开发故事。

## 15. 工程风险

| 风险 | 为什么重要 | 缓解方式 |
| --- | --- | --- |
| 太早过度建设图基础设施 | Neo4j、Qdrant、GraphRAG 会分散产品验证注意力 | 先用 Postgres 图表 |
| LLM 幻觉结构 | 错误观点会破坏信任 | 每个单元都要求 evidence span 和 confidence |
| 说话人归因错误 | 说话人错了，情报就错了 | 记录 speaker confidence，并允许人工修正 |
| 授权和隐私失败 | 对话数据高度敏感 | M0 就内建 consent、retention、deletion 和 audit |
| 多来源 scope creep | 每种 source 都有边界情况 | 用 connector interface，先 ship upload/transcript，再做 live meeting bot |
| 摘要变得泛化 | 失去差异化 | 让 graph 和 thought unit extraction 成为主产物 |
| 成本失控 | 长音频和多轮 LLM pass 成本高 | 小窗口抽取、缓存、provider routing、usage budget |

## 16. 技术建议

### 16.1 推荐 M0 技术栈

使用朴素组件：

```text
Next.js + Prisma + Postgres + Redis/BullMQ + object storage
Whisper/WhisperX local first
Claude/OpenAI-compatible LLM abstraction
Cytoscape/D3 for graph and timeline
```

只增加一个可选依赖：

```text
如果需要在 Postgres 内做语义搜索，再加入 pgvector
```

暂时不要加入：

```text
Neo4j, Qdrant, GraphRAG, LightRAG, Dify, LangChain, LlamaIndex
```

直到 Phase 3 的具体功能真正逼出需求。

### 16.2 推荐第一切入点

最好的第一切入点不是“所有对话”。

推荐切入点：

```text
面向小团队的专家 / 客户对话智能：
上传或导入 5-50 条电话、访谈或播客，抽取论证 / 洞察图谱，
再产出有证据支撑的 brief 和 agent-ready context pack。
```

理由：

- 高价值用户已经有痛苦的综合分析工作流。
- 私密录音和公开播客可以共享同一条 pipeline。
- 它能验证 corpus-level insight，而不要求实时会议捕获。
- 它与普通会议纪要工具区分开来，核心是结构和证据。

### 16.3 推荐第一个可见功能

在增加更多 ingest connector 之前，先构建 `Corpus Graph` 页面。

它应该展示：

- top claims；
- supporting evidence；
- objections；
- unresolved questions；
- participant/source distribution；
- timestamped proof。

这个功能会强迫产品验证新的核心论点：NanoSparks 的价值不是“更好的摘要”，而是“从真实交流中抽取可追溯的思想结构”。

## 17. 调研来源

- Gong: https://www.gong.io/
- Fireflies: https://www.fireflies.ai/
- Read AI: https://www.read.ai/
- Granola: https://www.granola.ai/
- Fathom: https://fathom.video/
- tl;dv: https://tldv.io/
- Dovetail: https://dovetail.com/
- Condens: https://condens.io/
- Looppanel: https://www.looppanel.com/
- Deepgram: https://www.deepgram.com/
- AssemblyAI: https://www.assemblyai.com/
- Speechmatics: https://www.speechmatics.com/
- Recall.ai: https://recall.ai/
- Polis: https://pol.is/home
- Polis source: https://github.com/compdemocracy/polis
- Kialo: https://www.kialo.com/
- Argdown: https://argdown.org/
- Qdrant: https://github.com/qdrant/qdrant
- Chroma: https://github.com/chroma-core/chroma
- Neo4j: https://github.com/neo4j/neo4j
- Mem0: https://github.com/mem0ai/mem0
- Whisper: https://github.com/openai/whisper
- WhisperX: https://github.com/m-bain/whisperX
- pyannote.audio: https://github.com/pyannote/pyannote-audio
- GraphRAG: https://github.com/microsoft/graphrag
- LightRAG: https://github.com/HKUDS/LightRAG
- VideoRAG: https://github.com/HKUDS/VideoRAG
