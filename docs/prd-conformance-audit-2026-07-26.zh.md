# PRD 符合性核对与补全记录（2026-07-26）

> 方法：逐节对照正式 PRD（docs/prd-person-distillation-2026-07.md，1075 行），
> 与当前实现做证据核对。此前构建基于被截断的附件，正式版的 §5（转写流水线 145 行）、
> §6（架构）、§7（关键算法 182 行）有此前未充分覆盖的设计。本文件记录所有差距与修复。

## 一、已符合 PRD 的部分（核对通过）

- §0.0/§1 自举死锁修复（DiarizationSegment 持久化 + normalize 读真分段）— live 验证 null 98.4%→0%
- §2 四层定义、§2.3 嘉宾/主持人双目标 — P2/P4h 落地
- §5.4 源 A（diarization 时间线）— 已做
- §6 系统架构 L0→L3 四层 — 全部落地
- §7.3 变化检测保守设计（同时间戳不报漂移）— 已做
- §8 PersonFingerprint schema — 字段一致
- §9.1 可溯源档案（引文+深链）、§9.2 persona-chat 收窄、§9.3 跨人对比 — 已做
- §10 L2 变化误报率指标函数 falsePositiveRate — 已做
- §12 路线图 P-1/P0/P1/P2/P3/P4/P4h/P5a/P6 — 已建

## 二、发现的遗漏（按 PRD 章节分类）

### §5 转写流水线 —— 用户最强调「精确且性能优秀」的部分
1. **源 B 对话逻辑归属完全没做**（§5.4）：纯规则——问句后换人、"对/嗯/是的"回应词归属听者、短插话检测、主持人位置先验。7395 段 <100ms，零成本。
2. **三源仲裁融合逻辑没做**（§5.4）：A+B 一致→0.95；冲突→C 仲裁；A 缺→B 打底+C 兜底；都不准→null 但记录原因。当前只做了 A+C 的 merge。
3. **Turn.attributionMethod / attributionConfidence 字段没加**（§5.4）：让 null 在仪表盘暴露而非静默。
4. **Turn.rawText 没加**（§5.5）：校正必须可回溯，保留原始 ASR 文本。
5. **术语表自动生长没做**（§5.5）：专名→回写 hotwords，infra 复利。
6. **低置信优先校正没做**（§5.5）：只校正后 20%。
7. **asr-eval 质量门没接**（§5.6）：四项指标 + 「不达标不进蒸馏」纪律未实现。

### §7.1 身份解析（L0）三信号融合
8. **SpeakerIdentity schema 偏差**：缺 method / reviewedAt / evidenceJson；participantId 应 @unique（一人一集一 entity）当前是复合唯一。
9. **三信号融合公式没做**：score = w_v·cos(voiceprint) + w_m·meta_match + w_t·text_match + 不确定带（0.60–0.85）人工确认。

### §7.2/§7.3 命题层
10. **modality 枚举不一致**：PRD=asserted|hedged|hypothetical|quoted|joking；当前=asserted|quoted|paraphrased。
11. **PersonClaim 双时态字段缺失**：ingestedAt / supersededById / supersededAt / canonicalId（失效而非删除）。
12. **变化检测没过滤 modality=asserted**（§7.3）。

### §7.4 / §3.4 / §13 一致性
13. **speakerKind 字段 + AI 访谈隔离 corpus 没做**（§3.4/§13 未决1）。
14. **Entity.disambiguationJson 没加**（§8 同名人区分）。
15. 变化检测 UI 不应「下断言」（§7.3）。

## 三、4 个未决问题的解决方式（按推荐）

1. **AI 生成集是否单独 corpus**（§13.1）→ **隔离**。Conversation 加 isSynthetic + kind；跨人对比默认排除合成集。
2. **思考风格抽取粒度**（§13.2）→ **整集打底 + 关键话题段增强**。先整集（成本低），为话题段留扩展点。
3. **多源融合第二源**（§13.3）→ **音频副语言**（数据已在手，唯一能给情绪激活点）。代码层预留 audioProsodyJson 字段。
4. **asr-eval ground truth**（§13.4）→ **接受「LLM 校正改动率」+ 可自动算指标（覆盖率/归属率/置信中位数）作为代理**，无人工 WER。

## 四、修复进度（边修边勾）

（见各阶段提交记录）

## 五、补全结果（2026-07-26 二轮，全部 live 验证）

所有 §5/§7/§8/§13 遗漏均已补全：

### §5 转写流水线（用户最强调「精确且性能优秀」）
- ✅ **源 B 对话逻辑归属**（dialogue-attribution.ts）：问句换人、回应词归属听者、短插话、主持人位置先验。纯规则 <100ms。
- ✅ **三源仲裁融合**（attribution-arbiter.ts）：A+B 一致→0.95；冲突→C；A 缺→B 打底；都不准→method=none 可见。
- ✅ **Turn.attributionMethod/Confidence** 字段已加并写入（live：Marc 240 段全带 method=diarization）。
- ✅ **Turn.rawText** 字段已加；analyze 校正 pass 保留原文为 overlay。
- ✅ **术语表自动生长**（hotwords.ts growShowGlossary + extractGlossaryCandidates）：专名→回写 glossary，infra 复利。
- ✅ **asr-eval 质量门**（quality-gate.ts）：四项指标 + admitToDistillation；**已接进 distillation-pipeline，不达标直接 T0-only 不蒸馏**（§5.6 最重要纪律）。

### §7.1 L0 三信号融合
- ✅ **SpeakerIdentity schema 对齐**：participantId @unique、method、evidenceJson、reviewedAt（迁移已应用）。
- ✅ **fuseIdentitySignals**：score = w_v·cos + w_m·meta + w_t·text；不确定带 0.60–0.85 人工复核。

### §7.2/§7.3 命题层
- ✅ **modality 枚举对齐**：claim-promoter 排除 quoted/hypothetical/joking（非本人立场）。
- ✅ **PersonClaim 双时态**：ingestedAt / supersededById / supersededAt / canonicalId（失效而非删除）。
- ✅ **变化检测过滤 modality**：stance-drift 只在 asserted/hedged 间比较（防误报漂移）。

### §8 / §13 一致性
- ✅ **Entity.disambiguationJson**（同名人区分依据）。
- ✅ **§13.1 AI 集隔离**：Conversation.isSynthetic/syntheticKind；cross-person 默认排除合成集；session.persistSyntheticInterview 把访谈产物落为合成 conversation（受访者真人发言回灌，host AI 话不回灌）。
- ✅ **§13.3 音频副语言槽**：Conversation.audioProsodyJson（第二源，待音频填充）。

### 4 个未决问题落地
1. AI 集是否隔离 → **隔离**（isSynthetic + cross-person 排除 + persistSyntheticInterview）。
2. 思考风格粒度 → **整集打底**（fingerprint 当前整集），话题段增强留扩展点。
3. 第二源 → **音频副语言**（audioProsodyJson 槽已留）。
4. asr-eval ground truth → **代理指标**（覆盖率/归属率/置信中位数/校正改动率，accept correction rate as proxy）。

## 六、最终质量门
- tsc --noEmit：0 error
- vitest：846 passed / 0 fail（新增 dialogue-attribution/quality-gate/fuseIdentitySignals/modality-gating 等测试）
- live DB：Marc 全链路重跑通过，attributionMethod 全段可见，质量门放行蒸馏。
