# NanoSparks 架构 2026-08：主脊 · 构建系统 · 信任代数

> 日期：2026-07-27 · 作者：Claude（基于 2026-07-26 全库架构审计）
> 性质：**约束文档**，不是愿景文档。刻意短。任何新功能先过 §1 的主脊测试。
> 前置阅读：docs/prd-person-distillation-2026-07.md（愿景）、审计结论（memory: person-distillation-audit-2026-07）

## 0. 一句话

产品只有一条主脊：**提交 → 精确归属的转写 → 阅读 → 人物档案**。
数据只有一条法则：**每个派生物可追溯、可重建、带诚实的信任度**。
判据只有一个北极星：**留出集预测**（用前 N−1 集的指纹预测第 N 集的立场）。

## 1. 主脊测试（每个功能必答）

> 这个功能在"提交→归属→阅读→人物"的哪一段？答不出来 = 冻结区。

- **主脊**：submit、resolvers、transcribe/diarize/normalize、reader、person hub、persona-chat、corpora ask/graph（阅读的延伸）。
- **冻结区**（保留代码、不投入、不修饰）：briefs / follows / notifications / community / collections / audit / metrics / glossary / packages / playlists / billing——审计实测 8 个域前端调用方为 0。恢复投入的唯一条件：主脊上的真实用户要求它。
- **战略方向**（PRD §3 的倒转）：AI 访谈者不是主脊的下游，是**上游传感器**——它产出的语料天生 100% 归属正确、天生有本人同意。历史播客是冷启动先验，不是终局数据源。

## 2. 数据构建系统（derivation build system）

审计发现的 8 个手工修复脚本（backfill/reattribute/repromote/renormalize/reextract/fix-consistency/extract-guest×2）是同一个缺失能力的代偿：**派生数据没有 make**。法则：

1. **稳定身份**：派生行以自然键 upsert，不做 delete-all+recreate。
   PersonClaim 键 = (entityId, sourceThoughtUnitId)。重建不换主键 → 指纹引文永不悬空。
2. **失效而非删除**（PRD §7.3 真正落地）：上游消失时，下游标 `supersededAt`，不物理删除。
3. **过期可检测**：`scripts/rebuild.ts` 是唯一的重建入口——检测悬空指针、
   可归属未归属的 TU、晚于 claim 的 TU、晚于 claim 的指纹；`--fix` 按依赖序重跑
   对应阶段（复用 distillation-pipeline 的现有阶段函数）。新的手工修复脚本 = 架构缺陷的信号。
4. **回填必须自报**：历史回填数据带 `method='backfill'` + confidence null，永不冒充真实运行产物（已落地，2026-07-27）。

## 3. 信任代数（trust algebra）

**信任是乘积，不是勾选。** 每条对外展示的 claim 带 `trust = ∏ 各环节置信`，因子可解释：

- `attribution`：证据 turn 的 attributionConfidence（真实归属运行产出的才算；backfill/未知 → 0.5）。
- `traceability`：证据 span 的质量（无 span → 0.3；零时间戳 span（回填伪造特征）→ 0.3；带时间锚的引文 → 0.95）。

实现：`src/lib/person/trust.ts`（纯函数）。API 按 trust 排序，UI 明示弱溯源。
**低信任不是隐藏，是降权 + 标注**——透明比整洁重要。
质量门只消费真实产出的指标；未知就是 `unverified`，大声记录，不折算成通过（已落地）。

## 4. 北极星的执行路径（不再是口号）

1. 采语料：5 个高频嘉宾 × 各 5 集（≈ ¥40 转写成本）。这是当前唯一缺的东西。
2. 跑 `留出集预测`：前 4 集蒸馏 → 预测第 5 集立场 → 与真实转写比对。
3. 得到第一个基线数。此后所有 L2/L3 的设计争论用这个数裁决，不用形容词。

## 5. 验收纪律（对上一轮"符合性剧场"的制度性回答)

- 任何"落地审计"由**非执行方**的另一个会话执行，只对照 PRD 的**验收数字**（不是功能清单）打分。
- 指标必须测**外生量**（真时长来自 GlobalEpisode，不来自 max(endMs)；置信来自归属运行，不来自回填常量）。
- 附录里"诚实标注"的每一条 DoD 缺口，在收束段落里**必须原样出现**，不允许聚合成 ✅。

## 6. 本次落地清单（2026-07-27）

| 件 | 文件 | 状态 |
|---|---|---|
| 诚实质量门（外生时长 + unverified 通道 + 排除回填） | quality-gate.ts / distillation-pipeline.ts | ✅ 已落地 |
| 诚实回填语义 + 数据修正脚本 | backfill-attribution-method.ts / fix-attribution-provenance.ts | ✅ 代码就绪，数据修正待用户执行 |
| 立场正则去字频化 | claim-promoter.ts | ✅ 已落地 |
| 信任代数 + API/UI 接线 | trust.ts / api/person/[id] / ClaimTimeline | 本次 |
| PersonClaim 稳定身份 + 失效而非删除 + 每条真实时间 | claim-promoter.ts | 本次 |
| persona-chat 零引文拒答 | persona-chat.ts | 本次 |
| rebuild：唯一重建入口（取代 repromote/reattribute 脚本） | scripts/rebuild.ts | 本次 |
| 北极星语料采集 + 留出集评测 | — | 待语料（§4.1） |
| 冻结区执行（砍孤儿路由） | — | 待用户拍板范围 |
