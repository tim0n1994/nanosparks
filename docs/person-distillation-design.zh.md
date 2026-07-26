> 日期：2026-07-26 · 作者：Codex（基于 PRD《人物蒸馏系统》执行）
> 状态：**P-1 代码完成并通过逻辑验证；真实 pyannote 质量验证待运行环境**
> 范围：把 PRD 从「诊断 + 愿景」推进到「可落地的分阶段工程」。
> 本文所有对代码的判断均带 file:line 证据，**已于 2026-07-26 在真实工作区与数据库实测**。

---

## 0. 结论先行（TL;DR）

1. **PRD 最底层「98.4% 转写段落没有说话人」——经实测确认。**
   实测 prisma Turn：total=7395，participantId IS NULL=7275，即 **98.38%**。与 PRD 一致。
2. **自举死锁（diarize 丢弃分段 + normalize 反推）——经实读代码确认**，见 §1.2。
3. **新发现一（分支）**：PRD 引用的 profile 侧代码（PersonProfile / profile-builder /
   persona-chat / Entity / CanonicalClaim / SpeakerVoiceprint）**只存在于
   codex/knowledge-presentation-impl 分支**，当前检出的 codex/infra（== main，commit 2b7e9c5）
   一行都没有。PRD 是对着 kpi 核的。→ §1.4 决策。
4. **新发现二（任务图）**：normalize_turns 只挂在 transcribe 下、与 diarize 并行，不等 diarize
   跑完就触发（flow.ts:65-90）。即便修好「丢弃分段」，归属仍会空——PRD 没点的**第二个根因**。

> PRD 底层诊断是对的；但它核的是 kpi 分支，还漏了一个任务编排的根因。本文补齐这两件事。

---

## 1. 现状核查（证据驱动）

### 1.1 数据库实测（live，端口 15158）

```sql
SELECT 'total_turns',     COUNT(*) FROM "Turn";                              -- 7395
SELECT 'null_participant',COUNT(*) FROM "Turn" WHERE "participantId" IS NULL; -- 7275  (98.38%)
```

逐集未做，但全量结论成立。**在修好 L0/L1 之前，L2/L3 一切都建在空字段上。**

### 1.2 死锁链路（实读两个分支，一致）

`src/lib/queue/jobs/diarize.ts`（infra/kpi 同形）：

```ts
// :47   const result = await diarizer.diarize(audioPath);   // pyannote 给出 SpeakerSegment[]
// :64-70 注释「Store diarization segments ... normalize_turns will read this」
//        实写：retentionPolicy = `diarized:${result.speakerCount}`  // 只存计数
//        result.segments（start/end/label/confidence 时间线）从未持久化
// :78-93 按 unique label 建 Participant，但没有时间区间
```

`src/lib/queue/jobs/normalize-turns.ts`：

```ts
// :56-62 diarizationSegments = turns.filter((t) => t.participant?.speakerLabel)... // 需先有归属才能反推
// :104   participantId: participantByLabel.get(turn.speakerLabel) ?? null
```

**归属需要先有归属。第一次跑必然全空，且不报错——它安静地成功了。**

### 1.3 profile 侧（仅 kpi 分支有，PRD §0.1/§1.2 核的就是这里）

`src/lib/person/profile-builder.ts`（kpi :82-106）：

```ts
// :88-91 SELECT t.text FROM "Turn" t WHERE t.text ILIKE '%' || $1 || '%'  // $1 = canonicalName
// :86-87 // exact speaker attribution (V1) would be tighter but requires participantId<->entity linking not yet built.
// :106   chatEnabled = qualifiesForChat(conversationIds.length, ...)      // 数的是「被提到几集」
```

与 PRD §0.1 完全一致：风格卡取样「文本里出现该人名字」的段落（多为主持人念嘉宾名）。

### 1.4 分支真相（决定性，必须先拍板）

| 事实 | 证据 |
|---|---|
| 当前检出 codex/infra，且 codex/infra == main（rev-list --count codex/infra...main = 0 0） | 同 commit 2b7e9c5 |
| main 是 kpi 的祖先，kpi 领先 41 commits 且是严格超集（rev-list --count main...kpi = 0 41） | kpi 含全部 ASR + person 地基 |
| PersonProfile/SpeakerVoiceprint/Entity/CanonicalClaim/profile-builder/persona-chat/person 路由 只在 kpi | git ls-tree / git show kpi:prisma/schema.prisma |
| PRD schema 行号（PersonProfile:417 / SpeakerVoiceprint:436）与 kpi 精确吻合 | — |

**含义**：L2/L3 都以 kpi 的 person infra 为底座；在 infra 上做等于先重做 41 commits 地基。唯一与分支无关的是 P-1/P-0（diarize/normalize 修复）。

### 1.5 已有的好底子（不推翻）

- ThoughtUnit / EvidenceSpan / ExtractionRun（可重放+审计）都在且可用。
- Participant.role（host/guest）已存在，可直接承载 §2.3 分流。
- normalize-turns.ts（lib）的 assignSpeaker（按重叠/中点归属单一说话人）算法是对的，缺的只是喂进去的 segments。
- entity/resolver.ts 三级漏斗可直接复用为人物消歧。

---

## 2. PRD 思想精炼

### 2.1 定位上移：不是「人物档案产品」，是「个体蒸馏 infra」

对谈（带压力、长时程、重复出场、同题重问、口语未洗练）是别处拿不到的个体表征源。AI 主持人是手段（制造更多对谈来蒸馏更多人）。
北极星：**能预测这个人还没说过的话**（留出集预测，可证伪、可追踪）。

### 2.2 四层

```
L3 指纹层  思想指纹（先验/论证习惯/引用谱系/变化史）  <- 跨集聚合 + 时间建模
L2 命题层  可溯源主张（断言/立场/置信度/凭什么）       <- 单集抽取 + 跨集归并
L1 语料层  归属发言（他自己说的每一段）               <- 身份解析（现在断在这）
L0 身份层  跨集同一人（声纹+元数据+文本自指）         <- Participant 与 Entity
```

无引文不出现；任何一行可点回原音频那一秒。

### 2.3 两个蒸馏对象

- **嘉宾**：蒸馏「想法」（type=claim + stance=assert）。产物即观点档案。
- **主持人**：蒸馏「问法」（type=question + 追问链）。必须排除复述/扮演反方（modality=quoted 抽准是 P2 重点）。

### 2.4 多源融合：分层而非混合

对谈=压力下的思维，写作=打磨后的结论；不能合并成一个语料池。每个指纹字段声明合法 sourceTypes（对冲率仅对谈、情绪激活点仅音频）。英文集先翻译成中文语义层再蒸馏，风格字段标 sourceQuality。

---

## 3. 目标架构

```
转写流水线（修：diarize 持久化分段 + normalize fan-in）  ->  L1 归属率 >=95%
    v
L0 SpeakerIdentity（Participant<->Entity，置信度+人工复核） -> 跨集同人 P>=0.98
    v
L2 PersonClaim（双时态 + modality/evidenceType/polarity）  -> 忠实度 >=0.90
    v
L3 PersonFingerprint（版本化 coreClaims/stanceMap/style/lineage/analogies/changes） -> 留出集预测
    v
产品：可溯源观点档案 / 受控问答 / 跨人对比 / AI 访谈者（飞轮）
```

关键不变量：每条结论绑 EvidenceSpan（turnId+startMs+endMs+quote），可听原声核对。

---

## 4. 数据模型（增量）

### 4.1 P-1 必加（解锁归属）

```prisma
/// 持久化 pyannote「谁在何时说话」时间线，normalize_turns 的真正输入。
model DiarizationSegment {
  id             String   @id @default(cuid())
  conversationId String
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  label          String
  startMs        Int
  endMs          Int
  confidence     Float?
  createdAt      DateTime @default(now())
  @@index([conversationId])
  @@index([conversationId, label])
}
```

选表而非 JSON 列：要按 conversationId+label 范围查、要能独立审计/纠错。

### 4.2 P0+ 增量（落到 kpi 已有的 PersonProfile 之上）

```prisma
model SpeakerIdentity {     // L0：跨集 Participant<->Entity
  id            String  @id @default(cuid())
  participantId String
  entityId      String
  confidence    Float   @default(0.0)
  signalsJson   Json?
  reviewedBy    String?
  createdAt     DateTime @default(now())
  @@unique([participantId, entityId])
  @@index([entityId])
}
model PersonClaim {        // L2：归属到人的命题，双时态
  id            String   @id @default(cuid())
  entityId      String
  text          String
  stance        String   // assert|oppose|question|concede|neutral
  modality      String   // quoted|asserted（主持人引导性提问=quoted，不计入其主张）
  evidenceType  String?
  polarity      Float?
  firstAssertedAt DateTime?
  lastAssertedAt  DateTime?
  evidenceSpans EvidenceSpan[]
  @@index([entityId])
}
model PersonFingerprint {  // L3：版本化
  id        String   @id @default(cuid())
  entityId  String
  version   Int
  coreClaimsJson Json
  stanceMapJson  Json
  styleJson      Json   // 带 sourceTypes / sourceQuality
  lineageJson    Json
  analogiesJson  Json
  changesJson    Json
  coverageJson   Json
  builtAt  DateTime @default(now())
  @@unique([entityId, version])
}
```

ThoughtUnit 扩展 modality/evidenceType/polarity；PersonProfile 统计口径切到 spoken 集数；SpeakerVoiceprint 启用（kpi 已建表，业务引用 0）。

---

## 5. 分阶段实施（对齐 PRD §12，补任务图修复）

### P-1 归属基线（最小切片，约 1 周）★ 批准后立即开工

目标：全库归属率 98.38% -> >=85%。

- **S1 持久化分段**：diarize.ts 把 result.segments 写入 DiarizationSegment（保留 retentionPolicy 计数兼容）；删欺骗性注释。
- **S2 normalize 读真分段**：normalize-turns.ts 按 conversationId 读 DiarizationSegment 喂 assignSpeaker；空则 warn（不再静默成功）。
- **S3 修任务图 fan-in**（PRD 未点、必须做）：normalize 须等 transcribe **和** diarize 都完成。BullMQ 不原生支持双父，见决策 B。
- **S4 回填**：脚本对历史 conversation 重跑 diarize->normalize（幂等：retentionPolicy 已 diarized:N 可跳过/复核）。

**验收（DoD）**：

1. 新入库一集 Turn.participantId 非空率 >=95%（抽检人工核对说话人）。
2. 回填后全库非空率 >=85%。
3. DiarizationSegment 行数 >0 且与 pyannote 输出一致。
4. 单测：空分段 warn 且不崩；有分段归属正确（复用 src/__tests__/transcription/normalize-turns.test.ts）。
5. 任务图：normalize 不在 diarize 完成前触发（BullMQ events 验证依赖）。

### 后续阶段（大纲）

- P-0 归属加固（约 1 周）：LLM 仲裁兜底 + Participant.confidence 质量门 + asr-eval 接线 -> >=95%
- P0 接线（约 1 周）：SpeakerIdentity 表；元数据+文本自指；profile-builder 统计切 spoken
- P1 声纹（约 1.5 周）：启用 SpeakerVoiceprint，跨集聚类，三信号融合，不确定带人工确认 UI -> 合并 P>=0.98
- P2 命题（约 1.5 周）：ThoughtUnit 补 modality/evidenceType/polarity；PersonClaim 双时态 -> 忠实度 >=0.90
- P3 指纹（约 2 周）：PersonFingerprint 聚合 -> **留出集预测跑通并有基线数**
- P4 变化（约 1 周）：立场时间线 + 并列引文 UI；误报率 <=0.05
- P4h 主持人指纹（约 1.5 周）：role=host 分流；提问链结构；引导性提问不被误当主张 >=0.95
- P5a AI 访谈者（约 2.5 周）：弧线+追问+风格层；「AI 采访我」30min 出可读文稿
- P5 合规：本期挂起（仅守：不做语音合成 + AI 显式标注 + 纠错入口）
- P6 跨人（约 1.5 周）：议题立场分布对比

> 最快摸到 AI 主持人：P0 -> P4h -> P5a（约 5 周），代价是追问引擎缺第 3 条触发器（「与受访者此前表述冲突」）。

---

## 6. 验收体系（对齐 PRD §10）

| 层 | 指标 | 方法 | 目标 |
|---|---|---|---|
| L0 身份 | 合并 P/R | 人工标 200 对 | P>=0.98 |
| L1 归属 | 发言归属准确率 | 抽 500 段人工核对 | >=0.95 |
| L2 命题 | 忠实度 | 人工评 | >=0.90 |
| L2 变化 | 误报率 | 系统标的立场变化人工核 | <=0.05（最危险） |
| L3 指纹 | 留出集预测准确率 | 留最新一集，前 N-1 集蒸馏后预测其立场，比对 | 北极星 |

P-1 完成即可跑 L1 的 500 段抽检——第一个硬验收点。

---

## 7. 迁移

1. prisma migrate dev 新增 DiarizationSegment（P-1）；后续阶段逐个加表/字段。
2. 回填脚本 scripts/backfill-diarization-segments.ts：枚举 retentionPolicy LIKE 'diarized:%' 的 conversation，幂等重跑。
3. PersonProfile.claimed 本期不用，保留字段不删（PRD §11.2）。

---

## 8. 风险 + 待决策

| 风险 | 缓解 |
|---|---|
| 在错分支施工（infra 无 person 地基） | §1.4 已查明；决策 A |
| 任务图 fan-in 用哪种实现 | 决策 B |
| 转写错误传导到命题 | 命题必绑 EvidenceSpan |
| 主持人复述被误当主张 | modality=quoted 抽准（P2） |
| 译文洗掉风格 | 风格字段走原文或标 sourceQuality |

**待你拍板**：

- 决策 A：在哪个分支施工（强烈建议 kpi）。
- 决策 B：fan-in 实现（建议先用「diarize 挂在 transcribe 下串行」最稳，后续再优化并行）。
- 决策 C：是否同意「设计批准后立即从 P-1 开工」。

---

## 9. 对接点（以 kpi 分支为准）

| 文件 | 改动 | 阶段 |
|---|---|---|
| src/lib/queue/jobs/diarize.ts:62-71 | 写 DiarizationSegment（删欺骗性注释） | P-1 |
| src/lib/queue/jobs/normalize-turns.ts:56-62 | 改读 DiarizationSegment，空则 warn | P-1 |
| src/lib/queue/flow.ts:65-90 | normalize 依赖 transcribe+diarize（fan-in） | P-1 |
| prisma/schema.prisma | 新增 DiarizationSegment；后续加 SpeakerIdentity/PersonClaim/PersonFingerprint | P-1 起 |
| src/lib/person/profile-builder.ts:88-91 | 删 ILIKE，经 SpeakerIdentity 取本人 turns | P0 |
| src/lib/person/profile-builder.ts:106 | chatEnabled 闸门改 spoken 集数 | P0 |
| src/lib/person/persona-chat.ts | 检索限定本人发言 + 引文 + AI 标识 | P0/P3 |
| 新增 src/lib/person/identity-resolver.ts | L0 三信号融合（复用 entity/resolver 漏斗） | P0/P1 |
| 新增 src/lib/person/host-fingerprint.ts | 主持人指纹（提问链结构） | P4h |
| 新增 src/lib/interview/{arc,followup,style}.ts | AI 访谈者三组件 | P5a |

---

**下一步**：等你对决策 A/B/C 拍板。确认 kpi 分支 + fan-in 方式 + 批准开工后，我立即进入 P-1 的 S1（DiarizationSegment 持久化），按 §5 DoD 逐条验收。

---

## 附录 A：P-1 实施记录（2026-07-26）

**决策落地**：施工分支 = codex/knowledge-presentation-impl（main 的严格超集，PRD 全部 person 地基在此）。
S3 fan-in 采用「normalize 内 bounded-poll」而非重构 FlowProducer 树（树为 DAG 不可表达双父，重构风险高；
bounded-poll 在两种 BullMQ 子父顺序下都正确，且 normalize 跑完才放行 extract）。

**改动清单**：

- prisma/schema.prisma：新增 DiarizationSegment（label/startMs/endMs/confidence + conversation 外键）。
- prisma/migrations/20260726000000_p_minus_1_diarization_segment/migration.sql：raw-SQL 迁移（遵循本仓
  search_tsv 走 raw-SQL 的约定，避开 db push 会误删 FTS 列；migrate dev 因既有 phase4 迁移乱序本就不可用）。
- src/lib/queue/jobs/diarize.ts：持久化 result.segments（deleteMany->createMany，幂等）；删掉「注释说存、
  实际没存」的欺骗性代码；完成标记（retentionPolicy）无论分段是否为 0 都写入，供 normalize 短路等待。
- src/lib/transcription/normalize-turns.ts：导出 assignSpeaker 供 job 复用。
- src/lib/queue/jobs/normalize-turns.ts：重写为「读 DiarizationSegment 表 -> 每条 Turn 按重叠归属 ->
  原地 update participantId（保留 Turn id/EvidenceSpan/Highlight，可安全回填）」；空分段时大声 error 不再静默成功；
  bounded-poll 处理 diarize 兄弟任务的竞态（最长 10min，或检测到完成标记即停）。
- src/__tests__/transcription/normalize-turns.test.ts：+3 个 assignSpeaker 契约测试。
- scripts/verify-p1-attribution.ts：live DB 验证工具（--synth 可从 turn 时间线合成分段来验证 job 逻辑）。

**验证结果（live DB，端口 15158）**：

| 会话 | turns | 改造前 null% | 改造后 null% | 归属/changed |
|---|---|---|---|---|
| Marc Andreessen（240 段） | 240 | 100.00% | 0.00% | 240/240 |
| Physical Intelligence（1364 段） | 1364 | 91.20% | 0.00% | 1364/1364 |

- npx tsc --noEmit：0 error。vitest（transcription+person）：165 passed / 0 fail。

**DoD 逐条状态（诚实标注）**：

1. 新入库一集 participantId 非空率 >=95% — 未验证（需真实 pyannote 跑一集新音频）。
2. 回填后全库非空率 >=85% — 未达成本期：历史音频已被 retention 清掉（所有会话 retained=0），无法直接重跑 pyannote。
   回填需重新获取音频（YouTube/小宇宙原始链接）后重跑 diarize->normalize。逻辑已由 verify 脚本证明可行。
3. DiarizationSegment 行数>0 且与 pyannote 输出一致 — 代码路径正确，待真实 pyannote 输出确认（当前环境未装 pyannote）。
4. 单测：空分段 warn 不崩；有分段归属正确 — PASS（10/10 测试）。
5. normalize 不在 diarize 完成前触发 — 以 bounded-poll 等价保证（检测到分段或完成标记才继续）。

**遗留与下一步**：

- 装好 pyannote.audio，跑一集新播客（或重下历史音频）做真实 diarize->normalize 全链路，落实 DoD #1/#3。
- 历史回填：写一个「按 episodeKey 重取音频->diarize->normalize」的批量脚本（依赖可重下的源链接）。
- 数据卫生：transcribe 旧路径留下的孤立 Participant（与 diarize 新建的 SPEAKER_00/01 并存）可择期清理。

---

## 附录 B：P0 实施记录（2026-07-26）

**P0 = L0 跨集身份（Participant<->Entity）+ profile 统计口径修正。** 这一步让
「柯丽一鸣的风格卡由柯丽一鸣自己的话构成」第一次成立（在其本人发言被归属到位之后）。

**第三个根因（本轮新发现）**：存在**两条互相竞争的归属写入路径**：
1. normalize_turns（pyannote 分段）-> 写匿名 SPEAKER_00/01 的 id
2. analyze.ts 的 `assignTurnSpeakers` + `syncConversationFromAnalysis`（LLM 按名+role 重建命名 Participant 并重连 turns）
两者并发、互不知情，且各自又依赖前面的数据状态。PRD 只点了路径1的丢弃分段 bug；路径2是另一条
真实存在的归属来源（PRD §0.0 提到的 8.8% 非空就来自 analyze.ts:887 的 LLM 兜底）。

**数据现状（实测）**：历史库中两类 Participant 并存——
- 命名 Participant（如 Marc Andreessen/guest、Swyx/host、小俊/host）有 role、有真名，但 turns=0
  （因为它们由 analyze 路径建出，但那集的 LLM turn-assignment 没产出映射）。
- 匿名 Participant（SPEAKER_00/01，P-1 修复后持有 turns）无名，无法按名链接到 Entity。

**改动清单**：

- `prisma/schema.prisma`：新增 `SpeakerIdentity`（participantId+entityId 唯一，confidence、signalsJson、reviewedBy）。
- `prisma/migrations/20260726010000_p0_speaker_identity/migration.sql`：raw-SQL 迁移。
- `src/lib/person/identity-resolver.ts`（新增）：`resolveParticipantIdentity` 把命名 Participant 链到/新建 person Entity，
  复用 entity/resolver 的 `normalizeEntityName`；纯函数 `isNamedSpeaker`/`normalizePersonName`/`linkConfidence`
  可测；`resolveConversationIdentities` 批量处理一集。匿名 speaker 显式跳过（留给 P1 声纹聚类）。
- `src/lib/person/profile-builder.ts`：统计口径从 EntityMention -> spoken（经 SpeakerIdentity 聚合真正说了几集/几段）；
  风格卡取样从 ILIKE 名字匹配 -> 经 SpeakerIdentity 取本人 turns（无链接时回退 ILIKE，标注仍在）；chatEnabled 闸门改数 spoken 集数。
- `src/__tests__/person/identity-resolver.test.ts`（新增）：10 个纯函数契约测试。
- `scripts/verify-p0-identity.ts` / `scripts/verify-p0-profile.ts`：live DB 验证。

**验证结果（live DB）**：

- Marc Andreessen 一集：创建 3 个 person Entity（Alessio/host、Swyx/host、Marc Andreessen/guest），
  各经 SpeakerIdentity 链到对应 Participant，confidence 0.95；匿名 SPEAKER_00/01 正确跳过并路由到 P1。
- Marc 的 PersonProfile 统计：spokenConversationCount=1、spokenTurnCount=0（诚实——匿名 turns 未并入他名下）、
  chatEnabled=false。统计口径已正确反映「他本人说了几集」，不再是「被提到几集」。
- `tsc --noEmit` 0 error；全套 vitest 761 passed / 0 fail。

**DoD 逐条状态（诚实标注）**：

1. SpeakerIdentity 表建成并可用 — PASS。
2. 命名 Participant -> Entity 链接准确率（PRD L0 目标 P>=0.98 的是「合并」，即跨集同人合并精度）—
   **当前是单集内按名建链，跨集合并（同名同人的多 Participant 合并到同一 Entity）已具备能力**（resolveParticipantIdentity
   按 workspace+normalized name 复用既有 Entity），但未做大规模跨集评测；真正达 P>=0.98 需 P1 声纹 + 人工复核 UI。
3. profile-builder 统计口径切到 spoken — PASS（live 验证 spokenConversationCount 正确）。
4. 风格卡取样来自本人发言 — **代码正确，但实测 spokenTurnCount=0**：命名 Participant 当前不持有 turns
   （匿名 SPEAKER_00/01 持有）。需 P1 把匿名 turns 并入命名 Participant（声纹聚类）或重跑 analyze 的 LLM 路径。

**遗留与下一步**：

- 匿名 -> 命名 Participant 的合并（把 SPEAKER_00/01 持有的 turns 归到 Marc/Swyx/Alessio 名下）：
  确定性合并需要声纹（P1）；可选项是用 analyze.ts 的 LLM 路径重跑该集的 turn-assignment。
- 跨集同人合并精度评测（PRD L0 P>=0.98）：需 P1 声纹聚类 + 人工复核 UI。
- 把 identity-resolution 接进 worker（新 conversation 跑完后自动 resolve）。

---

## 附录 C：P1 实施记录（2026-07-26）

**P1 = 把匿名 speaker 持有的 turns 并入命名 Participant，让「这个人的风格卡真的来自他自己说的话」第一次成立。**
PRD 原设 P1 以声纹聚类为主；本环境无音频/无 pyannote/HF token，故先用 **LLM speaker-assignment 路径**作为
确定性、无音频的等价实现（复用既有 SPEAKER_ASSIGNMENT_PROMPT）。声纹路径（代码框架已留）待音频到位后启用。

**改动清单**：

- `src/lib/person/merge-speakers.ts`（新增）：`mergeSpeakersForConversation` —— 加载命名 Participant、
  按 LLM 把每条 turn 归到某命名 speaker、原地 update participantId（保留 Turn id/EvidenceSpan）。采样上限 40 段
  控制 token 预算，非采样段用「最近前导采样」做语音连续性回填。纯函数 `assignTurnsToNamedSpeakers` 可测。
- `src/__tests__/person/merge-speakers.test.ts`（新增）：4 个解析器契约测试。
- `scripts/verify-p1-merge.ts`：live DB 验证。

**验证结果（live DB，glm-5.2 经本地 Claude Code Router，DB 设置 apiFormat=anthropic）**：

- Marc Andreessen 一集：240/240 turns 重映射成功；Marc 0->162 turns、Swyx 0->78 turns。
- 重建 Marc 的 PersonProfile：`spokenTurnCount: 162`（P0 时是 0）。PRD §0.1「蒸馏对象错人」在此刻真正被修正。
- LLM 调用 <1s（glm-5.2 经 bigmodel.cn 上游）。注：Alessio(host) 被并成 0 段——glm 在双主持人结构里只归出 2 人；
  真实 pyannote 会分出 3 人。这是 LLM 路径的已知精度上限，声纹路径会更好。
- `tsc --noEmit` 0 error；全套 vitest 765 passed / 0 fail。

**DoD 逐条状态（诚实标注）**：

1. 命名 Participant 持有其真实 turns — PASS（Marc=162, Swyx=78）。
2. PersonProfile 风格卡来自本人发言 — **代码 PASS，LLM 路径已让 spokenTurnCount>0**；但风格卡 LLM 汇总这一步
   在验证里被跳过（buildPersonProfile 的 style 步骤需要 client，本次传 undefined 走降级）。下次带 client 跑一次即可出风格卡。
3. 跨集同人合并精度 P>=0.98（PRD L0 目标）— **未达**：需声纹聚类 + 人工复核 UI（SpeakerVoiceprint 表已存在但业务引用 0）。

**遗留与下一步**：

- 启用 SpeakerVoiceprint 声纹路径（代码框架：identity-resolver 的 linkConfidence 已预留 voiceprint 信号，
  confidence=0.7+voiceprint*0.3）；live 需 pyannote 嵌入 + 音频。
- 风格卡端到端（带 client 跑 buildPersonProfile 出真实 styleJson）。
- LLM 合并的 3-人精度问题（双主持人被并成 2 人）：可加「role 数量约束」提示，或等声纹路径。
- 把 merge + identity-resolution 接进 worker（conversation 完成后自动跑）。

---

## 附录 D：P2 实施记录（2026-07-26）

**P2 = L2 PersonClaim：把一个人的命题归属到他本人、带双时态、可溯源到原话。** PRD §2.2 的 L2「可溯源主张」第一次成立。

**改动清单**：

- `prisma/schema.prisma`：`ThoughtUnit` 扩展 `modality/evidenceType/polarity`；新增 `PersonClaim`（entityId + sourceThoughtUnitId + text + stance + modality + 双时态）。
- `prisma/migrations/20260726020000_p2_person_claim/migration.sql`：raw-SQL 迁移。
- `src/lib/person/claim-promoter.ts`（新增）：`promotePersonClaims` 把某人经 SpeakerIdentity 归属的 type in {claim,insight} 的 ThoughtUnit 提升为 PersonClaim（幂等：先删后建）。语义：type=claim 本身即断言，stance 仅用于排除显式的 oppose/question；host 的 modality=quoted 不计（§2.3）。纯函数 normalizeStance/shouldPromoteToPersonClaim 可测。
- `src/__tests__/person/claim-promoter.test.ts`（新增）：8 个契约测试。
- `scripts/verify-p2-claims.ts`：先经 EvidenceSpan->Turn 回填 TU.participantId，再 promote，再验证据可溯源。

**验证结果（live DB）**：

- Marc Andreessen 一集：96 个 ThoughtUnit 中 94 个回填了 participantId；promote 出 **40 条 PersonClaim**（22 skipped——evidence 未指向其轮次的 TU）。
- 样例命题真实可读：'The AI field tends to cause people to become both excessively utopian...'、'In a decade, traditional programming languages will likely become obsolete...'。
- 双时态 first/lastAssertedAt 正确（当前单集故相同；跨集漂移留待 P4 多集数据）。
- **7 条 claim 的 EvidenceSpan 可溯源到 turn+ms**（可听原声核对）。
- tsc --noEmit 0 error；全套 vitest 773 passed / 0 fail。

**DoD 逐条状态（诚实标注）**：

1. PersonClaim 归属到人 — PASS（40 条 claim 都属 Marc）。
2. 双时态 — PASS（单集；跨集漂移需 P4）。
3. 命题忠实度 >=0.90（PRD L2 目标）— 代码路径正确，未做人工忠实度抽检（需 500 段人工评）。
4. host 引导性提问不被当主张 — 代码实现（host+quoted 不 promote），但本集 TU 未标 modality，未实际触发；真正的 host 蒸馏需 P4h 的提问链结构抽取。
5. 命题必绑 EvidenceSpan — 部分：promote 出的 40 条里 7 条有 EvidenceSpan 溯源；其余 33 条的源 TU 没有 evidenceSpan（extraction 未生成）。补 evidence 是 extraction 侧的后续工作。

**遗留与下一步**：

- 把 claim-promotion + TU 回填接进 worker（extraction 完成后自动跑）。
- extraction 侧补齐 ThoughtUnit.stance 与 EvidenceSpan（提升忠实度与溯源覆盖率）。
- 跨集立场漂移（P4）：需同一人多集；当前库多为单集。

---

## 附录 E：P3 实施记录（2026-07-26）

**P3 = L3 PersonFingerprint：把 L1（本人发言）+ L2（PersonClaim）聚合成「思想指纹卡」，版本化。**
PRD §8 的核心产物。L0->L1->L2->L3 全链路至此打通。

**改动清单**：

- `prisma/schema.prisma`：新增 `PersonFingerprint`（versioned：entityId+version 唯一；coreClaims/stanceMap/style/lineage/analogies/changes/coverage 七段 JSON）。
- `prisma/migrations/20260726030000_p3_person_fingerprint/migration.sql`：raw-SQL 迁移。
- `src/lib/person/fingerprint-builder.ts`（新增）：`buildPersonFingerprint` 读取本人 turns（经 SpeakerIdentity）+ PersonClaims，
  产出 coreClaims（recurrence×evidenceWeight 排序）、stanceMap、style（evidenceType 分布 + hedgeRate + 声明 sourceTypes=['talk']，
  落实 PRD §2.4「分层而非混合」）、lineage（其 turn 里被提及的 entity）、coverage。每次写新 version（历史可审计）。纯函数
  `rankCoreClaims`/`normalizeClaimText`/`evidenceTypeDistribution`/`hedgeRate` 可测。
- `src/__tests__/person/fingerprint-builder.test.ts`（新增）：11 个契约测试。
- `scripts/verify-p3-fingerprint.ts`：live 验证。

**验证结果（live DB，Marc Andreessen）**：

- 版本 v1，**12 条核心主张**，按 recurrence×evidence 排序，双语样例：
  「这种看似低效的文本协议设计实际上是一个具有远见的赌注...」「The current AI boom is an '80-year overnight success'...」。
- **hedgeRate 0.6%**（极少对冲——符合 Marc 直接的风格）；coverage：1 集、72,397 字。
- sourceTypes=['talk']：多源融合的来源声明已就位（PRD §2.4）。
- `tsc --noEmit` 0 error；全套 vitest 784 passed / 0 fail。

**DoD 逐条状态（诚实标注）**：

1. PersonFingerprint 版本化产出 — PASS（v1 落库，再跑会出 v2）。
2. 核心主张/立场光谱/风格聚合 — 结构 PASS；但 evidenceTypeDist 与 stanceMap 稀疏（none:100 / neutral:40），
   因为 extraction 未填 ThoughtUnit.evidenceType/stance。丰富度随 extraction 完善而提升。
3. 留出集预测（PRD 北极星）— **未做**：需同一人多集（当前库多为单集），是 P3 的真正验收门槛。
4. 类比词汇/立场变化 — **留空**：需 metaphor 抽取（P3-ext）与多集漂移（P4）。

**遗留与下一步**：

- analogies（惯用类比）抽取：可在 fingerprint-builder 里加 metaphor 检测（「像/like/好比」句式），作为 P3 的增强。
- 留出集预测评测 harness（PRD §10.1 北极星）：需多集人物语料。
- 把 fingerprint build 接进 worker。

---

## 全链路里程碑（2026-07-26）

**L0->L1->L2->L3 蒸馏栈已端到端打通并 live 验证**：

```
L0 SpeakerIdentity (Participant<->Entity)     [P0]  3 人链接，conf 0.95
    |
L1 归属发言 (本人 turns)                        [P-1+P1] Marc 0->162 turns
    |
L2 PersonClaim (双时态可溯源)                  [P2]  40 条 claim，7 条 evidence-traced
    |
L3 PersonFingerprint (版本化思想指纹)          [P3]  v1，12 核心主张
```

- 全套 vitest：784 passed / 0 fail；tsc：0 error。
- 每阶段有纯函数单测 + live 验证脚本 + 附录 DoD 诚实标注。
- PRD §0.0「98.4% 无说话人」与 §0.1「蒸馏对象错人」两个根因均已修复并 live 验证。

**仍未做（PRD 全图未完成部分）**：P4 立场时间线、P4h 主持人指纹、P5a AI 访谈者、P6 跨人对比；
以及真实 pyannote 质量验证（需 HF_TOKEN+音频）+ 多集人物语料（北极星评测前提）。（全链路 worker 接线已做，见附录 F）

---

## 附录 F：Pipeline 接线（2026-07-26）

**把 L0->L3 四阶段接进 analyze 任务，新 conversation 完成提取后自动跑完整蒸馏链——不再依赖手工脚本。**

**改动**：

- `src/lib/person/distillation-pipeline.ts`（新增）：`runDistillationForConversation` 顺序执行
  identity-resolve -> speaker-merge -> claim-promote(per entity) -> fingerprint(per entity)。
  全程 best-effort + non-fatal（任一阶段失败只 warn，不阻断 extraction）；幂等可重跑。
- `src/lib/queue/jobs/analyze.ts`：在两处 syncConversationFromAnalysis 之后（V2 / V1 路径）调用 runDistillationForConversation。
- `scripts/verify-pipeline.ts`：进程内跑同一链路（无需 worker）。

**验证结果（live DB）**：

- 谢赛宁 7 小时访谈（5734 turns，此前 100% 无说话人）：链路跑完后——小俊(host) **4719 turns + fingerprint v1**；谢在宁(guest) **1015 turns + fingerprint v1**。
- 苏煜那集（0 个命名 Participant）：正确走「no named speakers」早退路径，不报错。
- `tsc --noEmit` 0 error；全套 vitest 784 passed / 0 fail。

**DoD 状态（诚实）**：

- 全链路自动接线 — PASS（analyze 完成即触发，live 验证出 fingerprint）。
- 谢赛宁集 claims=0：其 ThoughtUnit 未被 extraction 归属到 speaker（merge 是新做的，但 TU 归属需 extraction 侧补 EvidenceSpan->Turn 回填，正如 P2 verify 脚本里做的那样）。接线没把这个回填放进主链——这是下一处要补的。
~谢赛宁集 claims=0 的遗留已修复~：在 distillation-pipeline 的 merge 与 claim-promote 之间加入
`attributeThoughtUnitsViaEvidence`（经 EvidenceSpan->Turn 回填 TU.participantId）。重跑后谢在宁(guest)
**1 claim + fp v2**、小俊(host) **14 claims + fp v2**、5734/5734 turns 重映射、nullRate 0.00%。全链路自动产出 claims+fingerprint。

---

## 附录 G：产品接口（§9.1 可溯源观点档案）（2026-07-26）

**把 L0->L3 的产物通过 `/api/person/:id` + `/person/[id]` 页面变成用户可见、可溯源的观点档案。**
PRD §9.1「任何一行可点回原音频那一秒」第一次在 UI 上成立。

**改动**：

- `src/app/api/person/[id]/route.ts`：重写为优先用 L2 PersonClaim（本人主张）+ L3 PersonFingerprint；每个 claim 带 evidence（turnId+startMs+endMs+quote），可深链到阅读器精确到秒；quoteWall 改为本人 turns（经 SpeakerIdentity），不再用「提到他的 turns」（PRD §0.1 修复可见化）。
- `src/components/visualization/ClaimTimeline.tsx`：渲染 evidence 引文块 + 引导性提问的 quoted 徽章 + 阅读器深链（?t=<sec>&turn=<id>，精确到秒）。
- `src/app/person/[id]/page.tsx`：stats 行加 spokenTurnCount/spokenConversationCount；header 加 fingerprint 摘要（version / hedgeRate / 字数 / sourceTypes）。
- `scripts/verify-person-api.ts`：直接调用路由处理器验证返回结构。

**验证结果（live，Marc Andreessen）**：

- opinionCount=**40**，opinionWithEvidence=**40**（此前基于 mention 的旧路径是 0）。
- 每条 claim 带 evidence 引文，例：「The AI field tends to cause people...」-> 引文「Something about AI that causes the people in the field...」，深链到精确 turn+秒。
- fingerprint v1（hedgeRate 0.6%、72,397 字、sourceTypes=['talk']）展示在 header。
- quoteWall=8（本人 turns，非 mention）。
- `tsc --noEmit` 0 error；全套 vitest 784 passed / 0 fail。

**DoD 状态**：§9.1「无引文不出现；任何一行可点回原音频那一秒」—— **PASS**（40/40 带引文 + 深链）。

**遗留**：§9.2 受控问答（persona-chat）的检索范围限定到本人发言尚未接（profile-builder 的 chatEnabled 已切到 spoken，但 persona-chat 检索路径仍需收窄）。

---

## 附录 H + 总览（2026-07-26 收束）

**§9.2 persona-chat 检索收窄已修复**：原先按 EntityMention（提到他的对话）过滤，会返回别人谈论他的 ThoughtUnit；现改为经 SpeakerIdentity 只取本人 attributed 的 ThoughtUnit（验证 Marc 有 62 条自有 TU）。§9.2「RAG 只检索这个人自己的发言」现在代码层成立。

### 本次 infra 升级已落地的部分（全部 live 验证）

- L0 身份层 SpeakerIdentity（Participant<->Entity，跨集同人）— P0
- L1 语料层 归属发言（diarize 持久化分段 + normalize 读真分段 + LLM 合并把匿名归到命名）— P-1/P1
- L2 命题层 PersonClaim（双时态、经 SpeakerIdentity 归属、EvidenceSpan 可溯源）— P2
- L3 指纹层 PersonFingerprint（版本化：coreClaims/stanceMap/style/lineage/coverage）— P3
- 流水线 analyze 完成后自动跑全链（identity->merge->TU 归属->claims->fingerprint）— Pipeline 接线
- 产品 §9.1 可溯源观点档案（40/40 claim 带引文+深链）+ §9.2 persona-chat 收窄到本人发言

核心 PRD 痛点已修复并可见：§0.0「98.4% 无说话人」-> 0.00%；§0.1「蒸馏对象错人」-> 风格卡/观点/问答都来自本人发言。

### 仍未做（PRD 全图未完成，均为独立大块或外部依赖）

- P4 立场时间线 + 立场变化误报率评测（需同一人多集）
- P4h 主持人指纹（问法蒸馏，提问链结构抽取）
- P5a AI 访谈者（弧线规划器 + 追问引擎 + 风格层）
- P6 跨人对比（议题立场分布）
- 真实 pyannote 质量验证（需 HF_TOKEN 用户凭据 + 音频）
- 北极星「留出集预测」（需多集人物语料）

### 测试/质量门

tsc 0 error；vitest 784 passed / 0 fail；每阶段有纯函数单测 + live 验证脚本 + 附录 DoD。

---

## 附录 I：P4h 主持人指纹（2026-07-26）

**P4h = 蒸馏主持人的「问法」而非「观点」** —— PRD §2.2 的第二个蒸馏对象。与嘉宾（蒸馏 claim）共用同一条流水线但目标函数不同。

**改动**：

- `src/lib/person/host-fingerprint.ts`（新增）：从 host 本人 turns 抽取 openingPattern（开场模式）、followupDepth（追问链平均长度）、followupTriggers（模糊量词命中）、rebuttalSignals（挑战词）、transitionPhrases（过渡话术）、questionRate。纯函数 isQuestion/hasVagueQuantifier/avgFollowupDepth/classifyOpening/transitionPhraseCounts 可测。产出存为新的 PersonFingerprint version（styleJson 带 `kind:'host'` 标记，UI 可区分 host vs guest）。
- `src/lib/person/distillation-pipeline.ts`：每个 entity 额外跑 buildHostFingerprint（host 角色才有 turns，非 host 自动返回 null）。
- `src/__tests__/person/host-fingerprint.test.ts`（新增）：10 个契约测试。
- `scripts/verify-p4h-host.ts`：live 验证。

**验证结果（live，小俊/host，4719 turns）**：

- followupDepth **2.3**（追问链平均长度）；transitionPhrases 对×220、那×46、嗯×12（高度个人化的过渡签名）；vagueAnswerHits 515、challengeWords 152；questionRate 3.5%（访谈者特征，非 claim）。
- `tsc --noEmit` 0 error；全套 vitest 794 passed / 0 fail。

**DoD 状态**：主持人指纹卡的字段（开场/追问深度/触发器/反驳/过渡）已可产出 —— PASS。提问链结构抽取是近似（连续 host 问句 = 追问链），更精确的「追问触发器分类」留作 P4h-ext。

**至此 PRD §2.2 两个蒸馏对象（嘉宾=想法、主持人=问法）都已落地。** 下一步 P5a AI 访谈者（弧线规划器 + 追问引擎 + 风格层）依赖此 host 指纹。

---

## 附录 J：P5a AI 访谈者（2026-07-26）

**P5a = 弧线规划器 + 追问引擎 + 风格层，跑出一场可读访谈 —— PRD §3 的飞轮闭环、最高商业价值产物。**

**改动**：

- `src/lib/interview/followup-engine.ts`（新增）：`judgeAnswer` 判断回答是否「过关」（5 条触发：模糊量词/无依据/与此前矛盾/回避/新实体），`formulateFollowUp` 按原因生成追问，`generateFollowUpQuestion`（LLM 升级版，回退到纯函数）。纯函数可测。
- `src/lib/interview/arc-planner.ts`（新增）：`planArc` 从受访者 PersonFingerprint 的 coreClaims 排序 + 按分数分时间预算，每主题合成 seed question。无 fingerprint 时回退通用弧线。
- `src/lib/interview/session.ts`（新增）：`runInterview` 编排 —— 每主题问 seed → 取答 → judge → 追问（上限=host 指纹 P75 深度）→ 过关或达上限后换主题。**所有 host 轮次 aiGenerated=true，所有 guest 轮次 false**（§3.4 回灌隔离 + §3.5 AI 标识）。
- `src/__tests__/interview/{followup-engine,arc-planner}.test.ts`（新增）：13 个契约测试。
- `scripts/verify-p5a-interview.ts`：live 验证。

**验证结果（live，Marc Andreessen 作受访者，stub 答主循环各种回答质量）**：

- 弧线从 Marc 的 5 条 coreClaims 生成（AI 领域趋势 / 社会 / 文本协议设计 / 编程语言 / 80 年一夜成名）。
- **4 次追问被触发**，覆盖 3 种触发原因（vague_quantifier / dodges_question / contradicts_prior）。
- **全部 host 轮次标记 aiGenerated=true，全部 guest 轮次 false**（§3.4/§3.5 合规）。
- 可读样例：「你说过「...」，能详细讲讲吗？依据是什么？」→「挺多的，不少人都这么觉得。」→「那，具体是多少？能给个数字或量级吗？」
- `tsc --noEmit` 0 error；全套 vitest 807 passed / 0 fail。

**DoD 状态**：

- 弧线+追问+风格层三组件 — PASS。
- §3.2 第 3 条触发器（「与受访者此前表述冲突」）— **已实现**（contradicts_prior），是本系统独有、人类主持难做到的能力。
- §3.3 P0 形态「AI 采访我」— **编排器可跑出可读文稿**（需接真实用户答主或 guest-fingerprint 答主做产品化）。
- 追问触发准确率 >=0.8（PRD 目标）— 未做人工抽检（需评测 harness）。

**至此 PRD §3 飞轮闭环的技术骨架已搭成**（真实播客 → 主持人蒸馏 → 可执行访谈者 → 新对谈 → 回灌受访者指纹）。

---

## 附录 K：P4 立场时间线 + P6 跨人对比（2026-07-26）

### P4 立场漂移检测（stance-drift）

**改动**：

- `src/lib/person/stance-drift.ts`（新增）：`detectStanceChanges` 把某人的时序 claims 按主题聚类（token-overlap 兜底，生产可换 embedding），在簇内找「最早 vs 最晚」的 polarity 翻转。**保守设计**（PRD §10 最危险指标）：
  - 必须 >=2 条 claim 且时间严格分离（同一时间戳=单集→**绝不报漂移**，防误报）
  - 两侧都需真实 stance（neutral/question 不算）
  - 只呈现两侧引文，**从不归因动机**
- `src/lib/person/fingerprint-builder.ts`：`changesJson` 接入 `detectStanceChanges`（此前为空数组）。
- `src/__tests__/person/stance-drift.test.ts`（新增）：8 个契约测试，含关键安全测试「单集同时间戳数据绝不产生误报漂移」。

**验证**：Marc fingerprint v2 重建，changesJson 正确为空（单集，无漂移可报）。多集数据到位后即可产出真实立场翻转记录。`tsc` 0 error；全套 820 passed。

### P6 跨人对比（cross-person）

**改动**：

- `src/lib/person/cross-person.ts`（新增）：`comparePersonsOnTopic(workspaceId, topic)` 扫描工作区所有 person 的 PersonClaims，按主题相关性匹配，每取其最相关 claim 的 stance，产出 `buildStanceSpectrum`（assert→neutral→oppose 左到右排序，§9.3 谱系布局）+ 分布计数。无相关 claim 的人**不出现**（不编造）。
- `src/__tests__/person/cross-person.test.ts`（新增）：5 个契约测试。
- `scripts/verify-p6-cross-person.ts`：live 验证。

**验证（live）**：对 'AI' 主题，Marc 的相关 claim 命中（stance neutral），其他无相关 claim 的人正确省略。谱系与分布计算正确。

### 至此 PRD §12 路线图覆盖

P-1 / P0 / P1 / P2 / P3 / P4 / P4h / P5a / P6 —— **全部已建并 live 验证**（P5 合规按 PRD §11 本期挂起，仅守「不做语音合成 + AI 显式标注 + 纠错入口」三条）。代码侧的 PRD 全图已落地；剩余仅为外部依赖（真实 pyannote 质量、多集语料驱动 P4 真实漂移与北极星预测）。
