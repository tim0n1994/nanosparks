# PRD：转写后的知识呈现体系 — 可视化 · 抽取 v3 · 人物 Skill（2026-08）

> 状态：PRD（不含实现代码）
> 母计划：`docs/iteration-plan-2026-08-production.md`（v4，A→B→C 主线不变，本 PRD 定义 V 轨道并入其中）
> 覆盖三个需求：① 播客内容的可视化呈现（2D/3D/图谱）② 知识抽取管线再迭代 ③ 跨集/跨节目沉淀"人物 Skill"，最终可与嘉宾对话
> 调研基线：sigma.js v4 / cosmos.gl / deck.gl / Apple Embedding Atlas / InfraNodus / Delphi.ai / GraphRAG vs LightRAG vs Graphiti 生产对比（2026-07）

---

## 0. 一句话架构

**读（阅读器）→ 看（三层可视化）→ 问（搜索/Ask）→ 人（Person Hub / Persona 对话）**——四层共用同一套证据链数据（Turn + ThoughtUnit + EvidenceSpan），可视化和 Persona 不是新数据系统，是同一数据的三种投影。这是相对所有竞品的结构性优势：Podwise 有摘要没图谱，InfraNodus 有图谱没证据链回放，Delphi 有 persona 没公开知识网络。

## 1. 现状盘点（哪些已建成、哪些是缺口）

**已建成（直接复用）**：
- 证据链：ThoughtUnit（7 类型）+ EvidenceSpan→Turn（时间戳级回放）
- 窗口化抽取 + 全局合并 + ExtractionRun 可重放（`src/lib/extraction/windowed-extraction.ts`）
- 图：GraphNode/GraphEdge（7 种关系，含 evidenceJson），builder（`src/lib/graph/builder.ts`）
- 检索：pgvector + FTS + RRF + cross-encoder rerank + **引用校验器**（persona 对话的地基）+ golden QA eval
- 前端图渲染：Cytoscape（将被替换，见 §2）

**结构性缺口（本 PRD 的靶子）**：
1. **ThoughtUnit 没有说话人归属**——只能经 evidenceSpan→turn→participant 间接推断，"谁主张了什么"无法直接查询。这是人物 Skill 的第一块地基，schema 越早改越便宜。
2. **没有实体层**——图谱节点只有 claim/topic/participant，没有跨集可对齐的 Person/Concept/Book/Product 一等实体，跨集图谱无从谈起。
3. **图是корpus 级全量重建**（builder 每次 delete+rebuild）——集数多了成本和时间爆炸，且无法沉淀跨集结构。
4. **观点没有立场和时间维度**——无法表达"A 反驳了 B"归属到人，无法表达"某人观点从 2023 到 2026 的演化"。
5. **可视化只有一个 Cytoscape 图**——没有集内时间线、没有语义地图、没有结构洞察。

---

## 2. 需求一：可视化呈现体系（三层）

### 2.1 设计原则

- **图是索引，阅读器是地面真相**：任何可视化元素点击后必须能落到"谁在第几分几秒说的原话"。禁止无证据悬浮节点。
- **2D 为主力，3D 只做探索模式**：3D 力导向图信息密度低、遮挡严重、导航成本高，是 demo 糖果不是工作界面。唯一值得 3D 的是语义星图的"银河漫游"模式（P2，见下）。
- **布局全部服务端预计算**（v3 迭代计划已定此原则）：前端只渲染坐标，不跑力导向模拟——移动端才能流畅。
- **每层回答一个问题**，不做"一张图什么都有"的杂烩。

### 2.2 三层视图

**L0 集内视图（嵌入阅读器，回答"这一集的结构是什么"）**

| 组件 | 形态 | 技术 | 数据 |
|------|------|------|------|
| 说话人泳道 | 横向时间轴，每人一条泳道，色块=发言段，密度=话轮长度；点击跳转阅读器 | d3 + Canvas（一集 ≤1k 段，Canvas 足够） | Turn（已有） |
| 话题河流 | Stream graph：话题随时间的消长（谁把话题带偏了、高潮在哪） | d3 stack + area | topic 类 TU + 时间窗（已有） |
| 论点树 | 本集 claim→evidence/objection/answers 的层级 DAG，纵向布局 | d3 tree/dagre 服务端布局 | TU + GraphEdge（已有） |

L0 是**读者用得最多的可视化**——它直接回答"值不值得读、从哪读"。放在阅读器 TL;DR 卡下方，默认折叠为缩略图。

**L1 语料/节目图谱（回答"这些集合起来在讨论什么"）**

- 节点：Entity（概念/人/书/产品，§3 新增）+ CanonicalClaim（跨集聚类后的观点）；边：现有 7 关系 + mentions/co_occurs。
- 渲染：**sigma.js v4 + graphology**（WebGL，MIT，v4 混合 DOM 标签解决了 WebGL 富标签难题；GitLab Knowledge Graph 同栈；周下载 25 万量级，生态活）。替换 Cytoscape 前端渲染，**API 与数据结构不动**。
- 布局：graphology ForceAtlas2 在 worker 里跑，坐标存 GraphNode.metadataJson（v3 计划原设计，落实）。
- 升级预案：>10k 节点时切 cosmos.gl（GPU 力导向，百万级），接口预留 renderer 抽象——但不提前做。
- **结构洞察面板（InfraNodus 借鉴，差异化关键）**：图不是让用户自己盯出结论的，右侧面板直接给：
  - 主题聚类 Top5（Louvain 社区检测，graphology 内置）+ 每簇代表观点
  - 桥接概念（betweenness centrality 高的节点 = 连接不同话题的枢纽，节点渲染更大）
  - **结构洞**：两个大簇之间零连接 → 生成"未被讨论的交叉问题"（喂给 Ask 一键提问）
  - 争议点：contradicts 边密集的 claim 簇 → "本语料最大分歧"
- 交互：搜索即定位（搜索框 → 匹配节点高亮 + fly-to）；点节点 → 右侧证据面板（原话引用+时间戳）→ 点击进阅读器；按说话人/时间/集数过滤染色。

**L2 语义星图（回答"知识的整体地形"，视觉招牌）**

- 数据：embeddings 表已有全部向量（512d/1024d）。服务端 UMAP 降维到 2D（worker 离线跑，坐标入库），密度聚类（HDBSCAN）自动打簇标签（LLM 给每簇命名）——即 Apple Embedding Atlas / Nomic Atlas 的自托管极简版。
- 渲染：deck.gl ScatterplotLayer + TextLayer（十万点无压力），每点=一个 ThoughtUnit/金句，颜色=节目或说话人，点击=证据卡。
- 用途：a) 语料首页的"知识星空"英雄图（获客传播素材，dogfood 发小红书）；b) 探索式发现（"原来这两档节目在聊同一件事"）。
- **3D 模式（P2）**：同一份数据 deck.gl OrbitView 切 3D 漫游，仅作彩蛋/分享传播，不承载工作流。不引入 R3F/three.js 全家桶。

### 2.3 搜索的呈现（"解剖"搜索如何进 UI）

检索后端已是 2026 生产级（hybrid+RRF+rerank+引用校验），缺的是**入口和联动**：

1. **全局搜索框（Cmd+K）**：多索引 typeahead——集 / 人物 / 概念实体 / 金句 四类分组直达；输入即 FTS，回车走 hybrid。
2. **问答（Ask，已有）**：升级为两级路由（借鉴 LightRAG dual-level，不引框架）：**local**（具体事实/某人某观点 → hybrid 检索 TU/Turn）与 **global**（"这个语料整体怎么看 X" → 先取相关聚类/社区综述再答）。路由用轻量 LLM 判定，ExtractionRun 记账。
3. **搜索 ↔ 图联动**：搜索结果页给"在图谱中查看"；图中选中节点给"以此提问"。
4. **实体感知**：搜人名命中 Person Hub（§4），搜书名/产品命中实体页（P2）。

---

## 3. 需求二：抽取管线 v3（在 windowed extraction 之上）

### 3.1 迭代内容（按依赖排序）

**E1 说话人归属 + 立场（schema 先行，Phase A 就做迁移）**
- ThoughtUnit + `participantId`（主张者）+ `stance`（assert/oppose/question/concede/neutral）。
- 抽取 prompt 增量：窗口内本来就带说话人标签，让模型顺手输出归属和立场——**并入现有窗口 pass，不加调用次数**。
- 价值：这一个字段解锁"谁主张/谁反对"查询、L0 论点树按人着色、以及人物 Skill 的全部观点库。

**E2 实体层（V2）**
- 新增 Entity 抽取任务（person/org/product/book/concept/event），同样并入窗口 pass 的多任务输出。
- **实体消解三级漏斗**（生产 KG 的第一失败点是重复实体，2026 共识）：①规范名精确匹配 → ②embedding 相似（pgvector，阈值内候选）→ ③LLM 仲裁（批量、便宜模型）。人物实体额外用声纹信号（§4.4）。
- schema：`Entity(id, workspaceId, type, canonicalName, aliasesJson, embeddingId)` + `EntityMention(entityId, conversationId, turnId, surfaceForm)`。

**E3 跨集增量合并（V2，替换全量重建）**
- 采纳 LightRAG 的**架构模式**（不引框架，ADR 沿用"不引入 GraphRAG/LightRAG"）：每集抽取产出局部子图 → 与语料图 set-merge（实体消解时合并节点，边取并集）→ 只有受影响的邻域重算聚类。builder 的 delete+rebuild 保留为"月度全量校准"命令。
- 观点规范化：跨集 claim 语义聚类 → `CanonicalClaim`（簇代表句 + 成员 TU 列表）。图谱 L1 展示 CanonicalClaim 而非原始 TU，密度立刻下降一个量级。
- 明确不做：GraphRAG 全图社区摘要（indexing 成本墙 + 不支持增量，生产教训明确）。社区摘要**只对两个对象做**：节目级综述、人物级观点综述（§4 需要）——按需生成、缓存、增量失效。

**E4 时间维度（V2 后期）**
- CanonicalClaim 成员按发言时间排序 → "观点演化时间线"（某人 2023 vs 2026 谈 AGI 的变化）。借鉴 Graphiti 的 bi-temporal 思想（事实时间 vs 记录时间），但只加字段不引框架：EvidenceSpan 已有时间戳，CanonicalClaim 加 `firstAssertedAt/lastAssertedAt`。
- 这是人物页的杀手内容，也是二创图文的高级素材（"XX 的观点变迁"天然是爆款选题）。

**E5 评测扩展**
- 现有 extraction eval + RAG eval 上追加：实体消解 precision/recall（人工标注 50 对）、claim 聚类质量（轮廓系数+人工抽检）、归属准确率（TU→participant 抽检）。

### 3.2 成本纪律

- 实体+归属+立场全部**并入现有窗口 pass 的一次调用**（多任务结构化输出），单集抽取成本增幅目标 <30%。
- 实体消解 LLM 仲裁攒批跑（便宜模型）；UMAP/聚类/布局全在 worker，零 LLM 成本。
- 全部经 ExtractionRun 记账，沿用"新 run 验收后原子切换"。

---

## 4. 需求三：人物 Skill —— 从"读播客"到"与思想对话"

### 4.1 对标与定位（Delphi.ai 拆解）

Delphi.ai：本人上传自己的内容 → 训练 Digital Mind → 粉丝付费对话（$99–299/月 + 语音克隆 $150/月；卖点=引用溯源、风格镜像、本人完全控制）。已验证 7 位数收入案例（Matthew Hussey 等）。

**关键差异**：Delphi 是**本人授权自建**；我们是**平台从公开播客自动沉淀第三方人物**。这决定了产品必须分两级形态——研究视图（无争议）默认开放，模拟对话（有争议）严格约束，本人认领后才升级为 Delphi 形态。**法律与伦理设计不是附录，是产品形态本身。**

### 4.2 产品形态分级

**P-1 Person Hub（人物页，事实性聚合——默认形态，类比维基/Google 知识面板）**

`/person/[slug]`：
- 人物卡：姓名/头衔（自我披露+主持人介绍中抽取，不爬外部资料）/出场统计（N 档节目 M 集 T 小时）
- **观点库**：CanonicalClaims 按主题分组，每条带立场、原话引用、时间戳、集链接——全部可回放
- 观点演化时间线（E4）
- 表达风格卡：口头禅、常用比喻、句式特征（统计+LLM 概括，展示为"这个人怎么说话"）
- 关系网：常同台的人、观点上 supports/contradicts 关系最强的人（迷你图谱）
- 金句墙（一键生成卡片 → 接 B1 分发）

**P-2 Persona 对话（"与 TA 的公开发言对话"——受约束的模拟）**

- **严格 grounded RAG**：检索范围 scope 到该 participant 的 Turn + TU（现有 hybrid 检索加一个 filter 即可），回答只能基于检索命中，**引用校验器（已建成）强制每段答案挂真实引用**；检索不到 → 固定话术："TA 在已收录的 N 集中没有公开谈过这个话题"。
- 风格：轻度模仿——system prompt 注入风格卡 + 3–5 条真实发言 few-shot（措辞节奏），**不做人格深度模拟、不做观点外推**。
- 界面强标识（《标识办法》显式标识义务 + 人格权避险）：对话头部常驻"AI 根据 {N} 集公开播客发言模拟，非本人，观点以原音频为准"；每条回答脚注引用。
- **解锁阈值**：出场 <3 集只有 Person Hub 无对话（数据太薄，模拟质量差且风险高）；UI 永远显示数据底座规模（Delphi 锚点：1M 词起步）。
- 不做（红线）：声音克隆、视频头像、主动人设扮演（"用 XX 的口吻骂人"类 prompt 拒绝）、把对话内容当作本人观点导出分发。

**P-3 认领态（本人认领后 → Delphi 形态，商业化入口）**

- 认领验证（社媒 OAuth/邮箱域名/播客 RSS 控制权）→ 本人获得：内容修正权、对话开关权、下架权、风格调教权。
- 商业化：认领人物页可开付费对话/引流位（对标 Delphi 定价锚），平台分成。这把最大法律风险方转化为付费客户——与 v4 C4"主播认领"合流为同一套认领体系。

### 4.3 Persona 构建管线（几乎全是已有能力的组装）

```
E1 归属+立场 ──┐
E2 实体消解 ───┼→ PersonProfile 聚合 job（按人增量重算）：
E3 CanonicalClaim ┘   观点库 / 演化线 / 风格卡(styleJson) / 关系网 / 人物综述(缓存)
                          │
Persona 对话 = person-scoped hybrid 检索(已有+filter)
             + persona system prompt(风格卡+few-shot)
             + 引用校验器(已有)
             + 拒答策略
```

净新增工作只有：PersonProfile 聚合 job、风格卡抽取 prompt、persona 对话的 prompt+拒答逻辑、人物页前端。检索、重排、引用校验、SSE 流式全部复用。

### 4.4 跨集同人识别（实体消解的人物特化）

1. 名字+上下文信号（主持人介绍、自我介绍、节目 shownotes）→ E2 三级漏斗。
2. **声纹辅助（P2）**：每集每说话人取 3 段清晰样本 → speaker embedding（pyannote/CAM++ 嵌入模型，段级样本 CPU 可跑）→ pgvector 存 `SpeakerVoiceprint` → 跨集余弦匹配作为消解的强信号。解决"嘉宾没被报名字"和同名人问题。
3. 人工修正回路沿用 I2 的 participant PATCH——用户合并/拆分人物，触发 profile 重算。

### 4.5 数据飞轮

集数↑ → 人物覆盖↑ → Person Hub 的 SEO 页（"{人名} 观点/访谈"是高意图搜索词）→ 引流 → 更多转写 → 观点库更厚 → 对话质量↑ → 认领动力↑。全局转写缓存（v4 ADR 4）让热门嘉宾的沉淀成本被全体用户摊薄——**人物库是缓存池的复利产物**。

---

## 5. 数据模型增量

| 实体/变更 | 关键字段 | 阶段 |
|-----------|---------|------|
| ThoughtUnit 扩展 | + participantId、stance | **A（迁移先行）** |
| Entity | workspaceId, type, canonicalName, aliasesJson, embeddingId | V2 |
| EntityMention | entityId, conversationId, turnId, surfaceForm | V2 |
| CanonicalClaim | corpusId, text, memberTuIdsJson, firstAssertedAt, lastAssertedAt | V2 |
| GraphNode/Edge 扩展 | node.entityId、edge + mentions/co_occurs；metadataJson 存布局坐标（已预留） | V2 |
| PersonProfile | entityId(person), statsJson, styleJson, summaryText, updatedAt | V3 |
| SpeakerVoiceprint | participantId, embedding(pgvector), sampleMetaJson | V3-P2 |
| EmbeddingProjection | embeddingId, x, y, clusterId, clusterLabel | V2（语义星图） |

---

## 6. 排期：并入 v4 主线（A→B→C 不动，V 轨道错峰）

| 版本 | 内容 | 挂靠 |
|------|------|------|
| **V1** | E1 schema 迁移+prompt 增量；L0 说话人泳道（阅读器内，最便宜最高频） | Phase A（A3 内，+2–3 天） |
| **V2** | E2 实体层、E3 增量合并+CanonicalClaim、L1 sigma.js 图谱+洞察面板、L2 语义星图、Cmd+K 搜索 | Phase C1 同期（公开页需要图谱与实体页做 SEO 面） |
| **V3** | E4 时间线、PersonProfile、Person Hub 页、Persona 对话 MVP、认领体系（与 C4 合流） | Phase C 后期，C4 数据闸门通过后 |

原则：**B（分发）优先级不受影响**——分发是增长引擎，V 轨道是深度引擎；V2/V3 的产出（星图、人物页、观点演化）反过来成为 B 的高级图文素材。

## 7. 指标

| 视图 | 指标 | 目标 |
|------|------|------|
| L0/L1/L2 | 可视化交互率（完读用户中打开任一视图）；图→阅读器回跳率 | 25%；50% |
| 搜索 | Cmd+K 周使用率；Ask local/global 路由命中满意度（追问率倒数） | 30% |
| Person Hub | 人物页 UV（SEO）；页→对话转化 | 对话转化 20% |
| Persona | 拒答率（健康区间 10–30%：太低=胡编，太高=数据薄）；引用点击率 | 区间内 |
| 抽取 | 实体消解 precision ≥0.9；归属准确率 ≥0.9；单集抽取成本增幅 <30% | eval 闸门 |

## 8. 风险

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 人格权/名誉权投诉（persona 说错话） | 中 | **高** | grounded-only+引用校验+拒答；强 AI 标识；<3 集不开对话；申诉下架 SLA 24h；敏感人物（政治）白名单制不开对话 |
| 实体消解错误合并两个人 | 中 | 高 | 三级漏斗保守阈值+声纹+人工拆分回路；错误合并的 profile 全量重算 |
| 图谱视觉华而不实（用户看不懂） | 中 | 中 | 洞察面板给结论而非裸图；L0 优先（最贴近阅读场景）；每层可视化上线前 5 用户可用性测试 |
| UMAP/聚类批任务拖慢管线 | 低 | 中 | 全部离线 worker、按语料增量重投影；星图允许"昨日数据" |
| 抽取成本失控 | 中 | 中 | 多任务并入单 pass；ExtractionRun 成本闸门；便宜模型仲裁 |
| persona 与本人真实观点漂移（旧言论过时） | 中 | 中 | 演化时间线明示时间；回答带发言年份；认领后本人可标注"已改变看法" |

## 9. ADR

| # | 决策 | 理由 |
|---|------|------|
| V-1 | 图渲染 sigma.js v4 + graphology 替换 Cytoscape 前端（API 不动）；>10k 节点再评估 cosmos.gl | WebGL 规模+v4 富标签；MIT；生态动量（10×/年）；Cytoscape Canvas 在千级节点即到瓶颈 |
| V-2 | 3D 仅作语义星图探索彩蛋（P2），不做 3D 知识图谱工作界面 | 信息密度与导航成本；诚实优于炫技 |
| V-3 | 布局/降维/聚类全部服务端预计算 | 移动端流畅；前端只渲染 |
| V-4 | 不引入 GraphRAG/LightRAG/Graphiti 框架，采纳其模式（增量子图合并、双级检索路由、bi-temporal 字段） | 已有 Postgres 栈覆盖存储与检索；框架锁定成本高；GraphRAG 全量重建与成本墙是明确生产教训 |
| V-5 | 社区摘要只做节目级+人物级，按需缓存，不做全图 | 成本墙；我们只有这两个对象需要"综述" |
| V-6 | 抽取新任务并入现有窗口 pass（多任务结构化输出） | 成本纪律；避免调用数翻倍 |
| V-7 | Persona 三级形态（Hub→受约束对话→认领态），grounded-only+引用校验强制 | 第三方人物的人格权风险必须产品化解决；引用校验器已建成是最大杠杆 |
| V-8 | E1（归属+立场）schema 迁移提前到 Phase A | 字段早加成本≈0，晚加要回填全量重抽 |

## 10. 参考来源（2026-07 调研）

- 可视化：sigma.js v4（gdotv 实践文）、cosmos.gl v3、react-force-graph、Cosmograph、Guideflow 2026 工具横评、Apple Embedding Atlas 论文、Nomic Atlas UMAP 文档
- 结构洞察：InfraNodus 方法论（4-gram 共现网络、Louvain、betweenness、结构洞→生成问题）
- 抽取/图：TigerGraph 企业 KG 五阶段（实体消解是第一失败点）、GraphRAG 生产教训（Microsoft June Feng）、LightRAG vs GraphRAG 成本对比（$180/14h vs $22/2h、增量索引决定性）、Graphiti bi-temporal、LightRAG 论文与 repo
- Persona：Delphi.ai 官网/定价/文档/风格指南/Immortal 案例
- 内部：prisma/schema.prisma、src/lib/extraction/windowed-extraction.ts、src/lib/graph/builder.ts、iteration-plan-2026-08-production.md v4

---

*PRD 版本: v1.0 | 日期: 2026-07-22 | 评审点: V1 随 Phase A 验收；V2 启动前复核 sigma.js 选型*
