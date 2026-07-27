# 流水线端到端审计：TheDiaryOfACEO 20 集（2026-07-27）

> 任务：处理 `@TheDiaryOfACEO` 最近 20 集，跑通完整链路，记录并尝试修复问题。
> 架构级改动按用户指示待审批。

## 一、已发现并修复的问题（小问题，已落地）

### P1. 频道解析只返回 10 个节目（已修）
- **现象**：`@TheDiaryOfACEO` 解析返回 10 集，用户要最近 20 集。
- **根因**：`resolveChannel` 三处硬编码上限 10（API 路径、yt-dlp 路径、默认参数），而 playlist 路径是 20——不一致。
- **修复**：`src/lib/resolvers/youtube.ts`（2 处 10→20）+ `src/lib/youtube/channel.ts`（默认值 10→20）。
- **验证**：`resolveUrl('@TheDiaryOfACEO')` 现返回 `episodeCount: 20`。

### P2. worker 缺 NODE_ENV 导致英文走死掉的本地 ASR（已修）
- **现象**：worker plist 没设 `NODE_ENV`；`QWEN_ASR_URL` 指向 `127.0.0.1:4319`（mlx ASR 服务未启动）。factory 在 `NODE_ENV !== 'production'` 时优先选 QwenAsrProvider，英文访谈会 `fetch failed`。
- **修复**：`com.nanosparks.worker.plist` 加 `NODE_ENV=production`，英文改走 Deepgram（真实 key 已配）。
- **验证**：直调 transcribe（NODE_ENV=production）→ Deepgram 成功，470 turns / 7219s / 46s 完成。

## 二、阻塞全链路的架构问题（需审批）

### P3. BullMQ FlowProducer 依赖树方向反了（核心阻塞）
- **症状**：所有集 transcribe job 卡在 `waiting-children` 永不执行（`attempts:0, processedOn:undefined`），导致 turns=0，analyze 报 "No turns found" 失败。中文集（谢赛宁/柯丽一鸣）和英文集（DOAC）都栽在这里——这是系统性、非语言相关的。
- **根因**：`src/lib/queue/flow.ts` 的 job 树：
  ```
  acquire
    ├── transcribe → normalize_turns → extract(analyze)   嵌套成 parent→child
    └── diarize
  ```
  BullMQ 5.x 的 FlowProducer 语义是 **children 先执行，parent 在所有 children 完成后才 completed**。所以实际执行顺序是叶子 `extract` 最先跑（此时 turns 还没产出）→ 失败 → normalize 永远 `waiting-children` 等 extract → transcribe 永远等 normalize。**依赖方向与意图完全相反**。
- **证据**：对照实验——全新第 2 集 ingest，transcribe 仍 `waiting-children/attempts:0`；直调 `processTranscribeJob` 则 Deepgram 正常产出 turns。证明链路本身可用，纯粹是 flow 调度失效。
- **附加设计缺陷**：注释说"normalize_turns depends on both transcribe + diarize"，但 BullMQ parent-children 模型无法表达"一个节点依赖两个不同分支的父节点"。normalize 是 transcribe 的 child，无法同时依赖 diarize。
- **影响范围**：所有走 FlowProducer 的新 ingest 都无法产出 turns（包括之前的中文集，靠后续 rebuild/脚本补的归属，原始 extraction 从未自动跑成）。

## 三、已知限制（非本次引入）

- **pyannote 说话人分离**：`pyannote.audio` Python 库未安装，diarize 持续失败。这是预期的（memory 记录"真实 pyannote 待 HF_TOKEN"）。diarize 失败本身非致命，但配合 P3 会导致 flow 残留。

## 四、建议的修复方向（供审批选其一）

### 方案 A：颠倒树方向（最小改动）
在 BullMQ FlowProducer 里，想做"A 先 B 后"，要把 B 设为 A 的 parent（parent 等 child 完成）。所以正确树应是执行顺序倒过来嵌套：
```
extract(parent)
  └── normalize(parent)
        └── transcribe(parent)
              └── acquire(leaf，最先跑)
```
需重写 flow.ts 的树结构。但 diarize 与 transcribe 的并行 + normalize 双依赖仍难表达。

### 方案 B：放弃 FlowProducer，改回显式串行 enqueue（推荐）
FlowProducer 的 parent-children 语义与"线性流水线 + fan-in"需求不匹配，且无法表达 normalize 依赖 transcribe+diarize 双分支。改回：每个 job 完成后在自身代码里 enqueue 下游（transcribe 完成后 enqueue normalize，normalize 内部检查 diarize 是否也完成再跑）。简单、可读、能表达多依赖。

### 方案 C：用 FlowProducer 但仅做单链 + diarize 并行
transcribe→normalize→extract 做一条串行链（用方案 A 的倒置树），diarize 单独 enqueue，normalize 内部检查 diarize 完成态（轮询或标记）。

## 五、已完成的进度

- 2 个小问题修复并验证（P1 频道 20 集、P2 worker NODE_ENV）。
- 20 集 episodeKey 已抓取（`youtube:{videoId}` 列表已记录）。
- 第 1 集音频已下载（137MB），直调转写已产出 470 turns 入库——证明 transcribe→Deepgram 链路完全可用。
- **阻塞点**：P3（flow 失效）不解决，批量 ingest 20 集仍会全部卡在 turns=0。

## 六、待决策

P3 是架构改动，按指示等审批。请选 A/B/C 之一（我建议 **B：改回显式串行 enqueue**），审批后我继续推进批量 20 集。
