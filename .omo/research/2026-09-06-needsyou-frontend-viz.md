# 未启动目标处置研究：前端可视化能力升级（2026-09-06）

> 目标原文（创建于 2026-08-02，blocked 35 天，tokens=0）：「理解项目诉求，根据当前后端管线和更好的可视化，升级前端能力，用到最前沿的Web技术栈，给我最大的惊喜，竭尽所能更好的呈现挖掘有价值数据，观点」
> 姊妹目标（前端链路问题排查）由另一代理研究，本报告聚焦可视化能力升级，结论按可合并设计。
> 调研方式：只读仓库 + git 历史 + 既有审计文档；未改任何代码/配置。证据标注：**VERIFIED**（直接观测）/ **INFERRED**（强支撑推断）/ **UNKNOWN**。

---

## 一、目标解读 + 前端/数据现状

### 1.1 目标解读

目标可拆为四个诉求：①理解项目诉求 ②基于后端管线做更好的可视化 ③用前沿 Web 技术栈 ④把管线挖出的有价值数据/观点呈现出来（"最大的惊喜"）。

**VERIFIED**：这四条与仓库既有 PRD《转写后的知识呈现体系》（`docs/prd-knowledge-presentation-2026-08.md`，v1.0，日期 2026-07-22，见 :247）逐条对应——其架构"读（阅读器）→ 看（三层可视化）→ 问（搜索/Ask）→ 人（Person Hub / Persona 对话）"（:10-12），调研基线覆盖 sigma.js v4 / cosmos.gl / deck.gl / Apple Embedding Atlas / InfraNodus / GraphRAG 对比（:6）。**该目标本质上是这份 PRD 的使命复述，而 PRD 的主体实现发生在目标创建之前（见 1.3 与第二节时间线）。**

### 1.2 前端技术栈现状：已经是前沿栈

**VERIFIED**（`package.json`）：

| 层 | 技术 | 证据 |
|---|---|---|
| 框架 | Next.js 16 / React 19 / Tailwind 4 | package.json:47,49,78 |
| 图谱（L1） | sigma 3 + graphology 全家桶（louvain/forceatlas2/metrics） | package.json:40-43,52 |
| 语义地图（L2） | umap-js（服务端降维）+ DOM 渲染 | package.json:57；SemanticAtlas.tsx:5-13 |
| 3D | three + three-spritetext + 3d-force-graph | package.json:54-55；KnowledgeGraph3D.tsx:114 |
| 数据可视化 | d3 7 | package.json:36 |
| 声明未用 | @deck.gl/* 9.3.7 已安装但 src/e2e 零引用（rg 无命中） | package.json:25-27 |

结论：目标中"用到最前沿的Web技术栈"这一条**已经满足**；deck.gl 是为星图规模化预留的依赖（PRD V-2 的 3D 彩蛋路径），当前未用。

### 1.3 已建成的可视化面（目标诉求②④的主体已存在）

**VERIFIED**（组件文件 + git 提交记录）：

- **L0 集内视图（阅读器内）**：`ReaderStructurePanel.tsx` 三 tab——说话人泳道/话题河流/论点树，点击 seek 播放器（:58,106-108,142-144）；对应 e2e `e2e/reader-l0.spec.ts`（无 fixture 自动 skip，:14-15）。
- **L1 语料图谱**：`InsightGraph.tsx`（sigma.js）+ 结构洞察数据结构 clusters/bridges/structuralGaps/controversies（:56-60）；`GraphExplorer` 组合页 `src/app/corpora/[corpusId]/graph/page.tsx`（:17-19）；API `src/app/api/corpora/[id]/graph/route.ts`（:1-9）。
- **L2 语义星图**：`SemanticAtlas.tsx`（UMAP 预计算投影，按簇着色，点击出证据卡，:5-13）；API `corpora/[id]/atlas/route.ts`。
- **3D 英雄图**：`KnowledgeGraph3D.tsx`（WebGL 检测后懒加载 3d-force-graph，:114）。
- **人物/观点**：Person Hub（`/person/[id]`）+ persona chat + ClaimTimeline；git 6859b06（07-24）、2f1b830（07-27 人物蒸馏栈）、0047571（07-27 trust algebra）。
- **趋势报告**：`corpora/[id]/trends/route.ts`——Top 复现观点 / 未解问题 / 争议话题 / TU 类型分布（:1-9）。
- 组件层共 16 个可视化组件（`src/components/visualization/`）；**孤儿组件 2 个**：`SpeakerTimeline.tsx`（:12）与 `TopicCluster.tsx`（:11）全库零引用（rg 验证），功能已被 ReaderStructurePanel 取代或从未接线。

### 1.4 数据管线已暴露的有价值数据（可视化的"矿"很富）

**VERIFIED**（`prisma/schema.prisma`，778 行 / 41 model）：

| 数据 | 行号 | 可视化价值 |
|---|---|---|
| ThoughtUnit（7 类型思考单元） | :319 | 观点/论证/金句的最小颗粒 |
| EvidenceSpan（时间戳级证据链） | :346 | 一切可视化点击回放的地基 |
| GraphNode / GraphEdge（7 种关系） | :363/:382 | L1 图谱 |
| Entity / EntityMention（跨集实体） | :403/:425 | 跨集对齐的人物/概念/书/产品 |
| CanonicalClaim（跨集规范化观点） | :442 | 观点演化与争议 |
| EmbeddingProjection（UMAP 坐标+簇） | :458 | L2 语义星图 |
| PersonProfile / PersonClaim / PersonFingerprint / SpeakerVoiceprint | :479/:515/:545/:498 | 人物页、观点库、风格卡 |

API 面：`corpora/[id]/{graph,atlas,trends,query-stream,context-pack}`、`person/[id]/{,chat,claim}`、`conversations/[id]/{thought-units,turns,highlights}` 共 51 个路由。**缺的不是数据，是让已建成能力真正生效并被看见的接线（v5 审计同结论，见下）。**

### 1.5 真正的可视化缺口

**VERIFIED**（`docs/iteration-plan-2026-08-v5.md`，2026-08-13 实测审计）：

1. **产能过剩、验证为零**：47,928 行代码、833 单测全绿，但 0 外部用户、0 次真实链接端到端验证、e2e 9 spec 合计 122 行（v5:12-14）；可视化 e2e 仅 6 行可达性 smoke（`e2e/visualization.spec.ts`），reader-l0 e2e 无 fixture 即跳过。
2. **登录墙挡死公开面**（P0-4）：公开页 `/p/[slug]` 等建成但爬虫拿到 302，获客收益恒为 0（v5:23）——一切"惊喜"外部不可见。
3. **建成未暴露**：2 个孤儿组件；D15"冻结区一月零执行"（v5:79）。
4. **规模预案未到触发点**：SemanticAtlas DOM 渲染注释明示"单语料几千 TU 以内够用，deck.gl 是可选 3D/规模化路径"（SemanticAtlas.tsx:5-13）。
5. 性能预算/移动端/RSC 拆分属于 v5 §11 计划（:654 起），尚未执行。

---

## 二、为何 0 tokens、35 天未启动

**VERIFIED 时间线**（git log + 全局线程清单 `~/.codex/.codex-global-state.json`）：

| 日期 | 事件 |
|---|---|
| 07-22 | 可视化 PRD 定稿（prd-knowledge-presentation:247） |
| 07-24→07-28 | 实现洪峰：InsightGraph/SemanticAtlas（113b422、4976eca）、ClaimTimeline+Person Hub（6859b06）、图内搜索与联动（4be3dd7、821b31f）、3D 英雄图（fd00165）、人物蒸馏栈（2f1b830）、暴露后端就绪能力（5415137） |
| 07-29→08-01 | 转向管线/LLM 硬化（限流、翻译、watchdog），最后提交 894b357（08-01） |
| **08-02** | **本目标创建**；同日活跃线程是「检查 nanosparks 后台未完成任务并继续完成剩余工作」（运行时恢复 EP139/140），非可视化 |
| 08 上中旬 | Clerk 认证/admin/邀请码等工作**未提交**堆积（当前 git status 约 30 项未提交，v5 §17 批次 0.2 同口径）；08-13 写下 v5 架构审计 |
| 09-03 | 「nanosparks 死文件清理 lint 归绿」线程；AGENTS.md 重写、.next 重新构建 |
| 09-06 | 本次处置研究 |

**原因分析**：

1. **INFERRED（最强解释）——目标创建即过时**：它复述的使命在创建前 10 天已被实现洪峰完成 70-80%；创建时项目的真实瓶颈已从"建可视化"漂移为"接线与验证"（v5:12-14 的官方结论）。一个看起来"已完成大半"的开放式目标在调度上自然让位于运行时恢复、认证等更紧迫的目标。
2. **INFERRED——开放式措辞无法判定完成**："给我最大的惊喜"没有可证伪的验收标准，目标系统无法推进/判定，只能 blocked 挂起；同类工作实际以普通会话形式完成（07-24~28 的提交、09-03 的清理线程都绕过了该目标）。
3. **INFERRED——注意力迁移**：08 月起用户转入 Mystic、AIGC research、FortuneAI 等其他项目（记忆库时间线），NanoSparks 仅剩零星运维型会话。
4. **UNKNOWN——目标系统本身的阻塞机制**（为何 35 天不调度）在仓库内无直接记录，以上为仓库+线程证据的合理重建。

---

## 三、是否真正需要用户决策

### 判定：**NO**（前端可视化范围内无需用户决策；仅两个边界项除外）

理由：

1. **技术选型已有决策记录且仍然成立**：PRD ADR V-1（sigma.js v4+graphology，>10k 节点再评估 cosmos.gl）、V-2（3D 只做星图彩蛋）、V-3（布局/降维/聚类全部服务端预计算）（prd-knowledge-presentation:228-230）——2026-07 调研背书，与现栈零迁移成本。不需要新决策。
2. **剩余缺口是工程任务而非产品抉择**：接线/删孤儿/真实数据 e2e/洞察面板收尾/性能预算，全部可写出可证伪验收标准（见第四节）。
3. **用户已预授权**："很多不需要我决策，你接着做" + GLM token 无预算限制。
4. **边界（仅此处需要用户）**：①邀请真实外部用户（v5 批次 4.4，:910）②任何付费外部服务 ③公开部署决策。三者都不阻塞可视化工程工作本身。

---

## 四、可自主推进的具体下一步（排序，每步带验收）

**前置（P0，与姊妹目标/v5 批次 0 合流，先到先做）**：提交约 30 项未跟踪改动 + 建 git remote（v5 §17 0.1/0.2）；起 docker 栈拿到真实数据实况。可视化执行者不在脏工作树上开工。

| # | 步骤 | 内容 | 验收标准 | 工作量 |
|---|---|---|---|---|
| 1 | **去孤儿/激活资产** | 处置 SpeakerTimeline 与 TopicCluster：被 ReaderStructurePanel 取代则删除；若 /visualization 页仍需集级时间线则接线并补测试 | 全库 0 孤儿可视化组件（或接线处有单测）；`npm run verify` 全绿；工作树干净 | 0.5-1 天 |
| 2 | **真实数据可视化验证** | 配置 E2E_CONVERSATION_ID fixture，让 reader-l0 e2e 真跑；把 visualization.spec 从 6 行 smoke 扩为：graph 页渲染节点数>0、atlas 渲染点数>0、person 页渲染观点、trends API 返回非空 | e2e 非 skip 全通过；四个可视化面均有真实数据断言；verify 全绿 | 2-3 天 |
| 3 | **L1 洞察面板收尾** | 用最大语料（~16k 节点）实测 clusters/bridges/structuralGaps/controversies；补"structural gap → 以此提问"到 Ask 的接线 | 洞察服务端计算 <500ms；每条洞察可深链到证据原话；gap→Ask 路径 e2e 通过 | 2-4 天 |
| 4 | **星图规模化预案（按需）** | 仅当语料超数千 TU：SemanticAtlas DOM → deck.gl ScatterplotLayer（依赖已在 package.json:25-27），并加 PRD V-2 的 3D 轨道彩蛋；未达规模则跳过 | 触发条件下 10k 点首绘 <1s、拖拽 60fps；彩蛋模式可分享（satori 管线已存在） | 按需 3-5 天 |
| 5 | **可视化指标埋点** | 对接 v5 批次 3.2 的 ReadEvent：埋 PRD §7 指标（可视化交互率、图→阅读器回跳率） | admin/dashboard 可见数字；可生成周报 | 1-2 天 |
| 6 | **可用性测试 + 惊喜物料** | PRD §8 要求每层可视化上线前 5 用户测试；dogfood 生成 3 件传播物料（星图英雄卡/人物观点演化线/争议地图） | 3 件物料可导出 PNG（AIGC 管线已有）；测试记录落 docs/。外部真实用户测试需用户参与（边界） | 2-3 天 |

**推荐技术栈（及理由）**：维持现状——L1 sigma.js+graphology（ADR V-1，生态活跃、API 不动）、L2 先 DOM 后 deck.gl（依赖已装，规模触发才换）、L0 d3/Canvas、3D 仅 three/3d-force-graph 彩蛋（ADR V-2）、布局/降维全部服务端预计算（ADR V-3，移动端流畅）；阅读器按 v5 §11.2 拆 RSC（首章 payload <150KB 预算）。**不引入任何新框架**（无 R3F、无 cosmos.gl、无虚拟列表库），步骤 1-3 零新增依赖，与 Next 16/React 19/Tailwind 4 完全兼容。

**与姊妹目标的合并接口**：姊妹目标（前端链路问题排查）应拥有 P0-4 登录墙白名单、缓存架构（v5 批次 1，:873）与链路排查；可视化轨道拥有 components/visualization、ReaderStructurePanel、graph/atlas/trends 路由。文件面无重叠，可并行；两轨道共享 v5 为总纲与批次 0 前置。登录墙打开前，可视化成果对外不可见——这是两报告结论可合并的关键依赖序。

---

## 五、建议处置

### **execute**（重新界定范围后执行）

**理由**：

1. **不 close**：目标剩余实质（激活孤儿资产、真实数据验证、洞察收尾、指标埋点）真实且高杠杆——v5 的核心批评正是"已建成能力的收益被接线缺陷吃掉"（:12-14），close 等于把建成即不可见的状态永久化。
2. **不 needs-user**：技术决策已有 ADR 背书、工程缺口可自主验收、用户已明示"你接着做"。
3. **执行方式**：将"给我最大的惊喜"翻译为第四节步骤 1-5 作为 definition of done（步骤 6 的外部用户环节留给用户边界）；预期成果=三层可视化真实可用、被真实语料验证、带指标。这就是该目标 2026-08-02 想要而未拿到的"惊喜"。

---

### 附：关键证据索引

- PRD：docs/prd-knowledge-presentation-2026-08.md:6,10-12,228-230,247
- v5 审计：docs/iteration-plan-2026-08-v5.md:12-14,23,79,654,850-922
- 技术栈：package.json:25-27,35-43,47-57,78
- 数据模型：prisma/schema.prisma:319,346,363-458,479-545
- 组件：ReaderStructurePanel.tsx:58-144；InsightGraph.tsx:56-60；SemanticAtlas.tsx:5-13；KnowledgeGraph3D.tsx:114；SpeakerTimeline.tsx:12；TopicCluster.tsx:11
- API：api/corpora/[id]/graph/route.ts:1-9；trends/route.ts:1-9
- 验证缺口：e2e/reader-l0.spec.ts:14-15；e2e/visualization.spec.ts（6 行）
- git：最后提交 894b357（2026-08-01）；可视化实现洪峰 113b422/4976eca/6859b06/4be3dd7/821b31f/fd00165/2f1b830/5415137（07-24→07-28）；当前约 30 项未提交（Clerk/admin/flags）
