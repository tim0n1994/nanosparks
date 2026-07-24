# 转写事实校正增强 (Fact-Based Transcription Correction)

> 日期: 2026-07-24
> 状态: 已批准
> 上游探查: correction-pass.ts 现有三类修正（术语/口癖/格式），不做实体校正

## 目标
转写完成后、analyze 之前，根据播客元信息（标题/节目名/描述）通过 LLM 校正转写中的人名、公司名、产品名等事实性实体，使内容更精确。增强现有 correction pass，不重建。

## 现状
`correction-pass.ts` 已在 analyze 之前运行，做三类修正：(1) glossary 术语替换 (2) 口癖压缩 (3) 中英格式化。不做事实性实体校正——转写"物理智能"不会被校正为"Physical Intelligence"。播客描述在解析后被丢弃（未持久化）。

## 设计（增强现有 correction pass）

### 1. 持久化播客描述
- `GlobalEpisode` 加 `description String?`
- `cache.ts` 的 `globalEpisode.create` 写入 `resolved.description`
- 原因：描述包含最丰富的实体线索

### 2. LLM 提取实体候选
`correction-pass.ts` 新增 `extractEntities(client, metadata)` → 一次轻量 LLM 调用，从 title+showTitle+description 提取实体列表（人名/公司名/产品名/技术术语）。

### 3. 增强校正 prompt
现有 prompt 注入"已知实体"段落 + 第 4 类修正规则：
```
4) 实体校正：根据「已知实体」列表纠正转写中的人名/公司名/产品名写法。
   仅校正已有实体的写法，不引入新实体，不改变原意。
【已知实体】Physical Intelligence, 柯丽一鸣, Pi, OpenAI...
```

### 4. 接口变更
- `CorrectionGlossary` 加可选 `entities?: string[]`
- `runCorrectionPass` 加可选 `metadata?: { title?, showTitle?, description? }` 参数
- metadata 非空时先提取实体，注入 prompt

## 防护
- 实体提取失败 → 跳过实体段落，退化为现有三类修正（不阻断）
- 校正守"不改变原意、不增删信息"红线
- 成本：+1 次轻量 LLM（~500 token），受 ¥3/集 熔断约束
- 仍写 Turn.text（与现状一致）

## 验收
- 转写"物理智能"→"Physical Intelligence"、"克利伊明"→"柯丽一鸣"
- 校正后文本进入 analyze（导读提取看到正确实体名）
- 实体提取失败不阻断管线
- 现有测试不回归

## 不做
- 不拆独立队列任务（现有位置足够）
- 不改 Turn schema
- 不回写 glossary
