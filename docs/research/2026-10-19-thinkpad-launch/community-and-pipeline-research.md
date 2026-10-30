# 调研：ThinkPad 上线后第一次迭代应该做什么（2026-10-19）

状态：只读调研与判断，不含实现结论以外的承诺。实现范围见 `docs/iteration-plan-2026-10-19-thinkpad.md`。

## 1. 社区同类产品在竞争什么

| 产品 | 定位 | 对本项目的启示 |
| --- | --- | --- |
| [Podwise](https://podwise.ai) | 听后结构化学习：摘要 / 大纲 / 思维导图 / 全文 / 高亮 / Q&A / 12 语翻译 / Notion·Readwise·Obsidian 导出 / Pro 含 CLI·API·MCP | 卖点是"takeaways in seconds"和 Pro 的"priority processing"——**交付速度本身是付费点**。功能面上 NanoSparks 已基本覆盖（导读、金句、章节、双语、高亮、发布包、Ask、图谱）。 |
| [Snipd](https://apps.apple.com/us/app/snipd-ai-podcast-player/id1557206126) | 边听边抓：耳机轻点保存片段 + AI 转写摘要 + 同步 Notion | 转写是即时可见的基础层，AI 层后到；用户不等"全部完成"。 |
| [Dexa](https://dexa.ai/introducing-dexa) | 跨播客问答，答案带集数与时间戳引用 | 证据回链（原话 + 时间）是信任基础，与本项目 G5 一致。 |
| [Scriberr](https://github.com/rishikanthc/scriberr)（开源自托管，3.1k★） | 本地 Whisper/Parakeet + 说话人分离 + 与转写对话 + 文件夹监听 + API | 自托管项目把**后台任务可靠性和就绪信号**当作一等公民（启动完成有明确日志信号）。 |
| OpenTranscribe / Speakr / WhisperX（开源） | 自托管转写 + 分离 + 搜索 | 弱算力部署普遍采用"先出可读转写、重计算异步后置"的分层交付。 |

共同模式：**分层渐进交付**（转写先可读 → AI 增强层陆续到位）、**交付时延是产品指标**、**后台任务不得静默失败**。

## 2. 内部证据（2026-10-19 在 <deployment-host> 实测）

- VERIFIED：阅读器在 `status ∈ {transcribed, completed}` 即渲染（`src/app/read/[conversationId]/page.tsx:101`），即转写完成就可读；导读/TL;DR 要等 `completed`。
- VERIFIED：`analyze` 关键路径 = 纠错 → 抽取 → **ThoughtUnit embedding（内联、阻塞）** → 英文整集翻译（内联） → 入队 project/person_profile → `completed`。本机 bge-m3 CPU 推理实测 32 条短文本 ≈ 25 s，平均一个对话 496 条 ≈ 6–7 分钟；这段时间用户看到的是"生成导读"而非导读。
- VERIFIED：Redis 存量失败任务全部来自 Mac 时代（最新 2026-09-06）：transcribe 148（103 条 "No audio file found"，重启后 /tmp 音频丢失）、analyze 237（175 条 "job stalled"）、project 263（260 条 "job stalled"）、ingest 6（yt-dlp 403 / JS runtime）；另有 analyze 51、normalize_turns 54、ingest 3、transcribe 3 个 `waiting-children` 父任务自 7 月 28 日起永远等不到子任务。
- VERIFIED：`worker-factory.ts` 的 `lockDuration` 已是 300 s、`stalledInterval` 600 s，仍大面积 stalled，说明事件循环被**同步计算**冻结超过 5 分钟。`projectCorpus()` 对整个 corpus 的 ThoughtUnit 做 `umap.fit()`（同步），最大 corpus 现有 58,409 个 TU × 1024 维；所有队列共用一个 worker 进程，project 冻结期间 ingest/transcribe/analyze 的锁也续不上——这是 analyze 175 个 stalled 的连锁根因。ThinkPad（i5-2520M，2 核）上第一集 `completed` 就会触发同样的事故。
- VERIFIED：`/api/health/worker` 只看 3 个队列（worker 注册 8 个），Redis 出错时把计数替换为 0，并且不含 `waiting-children`；`scripts/deploy-prod.sh` 面向 macOS launchd（`com.nanosparks.web`，端口 7557），在 ThinkPad 上不可用，且文档已记录它不是验收门禁。
- VERIFIED：`Conversation` 只有 `createdAt/updatedAt`，没有"何时可读 / 何时导读完成"的时间戳；业务北极星"首集 P50 < 10 分钟出可读"从未被测量，也无法从现有数据回算。
- VERIFIED：上轮 G7"真实新鲜处理"未通过的两个障碍已消除：YouTube 下载改走 mihomo 代理实测可下载；用户已授权付费 provider（Deepgram、网关 `auto`）。
- UNKNOWN：Deepgram 说话人分离在本机链路里的实际归属质量；ThinkPad 带宽下的下载耗时；英文整集翻译的真实耗时与成本；公开暴露后的外部用户行为。

## 3. 判断

1. 第一次迭代不该加功能。功能面已与 Podwise 持平，缺的是**可度量、可重复的"贴链接→可读"交付**，以及一个不会被自身后台任务拖死的 worker。
2. 社区的分层交付模式直接适用：embedding 与 atlas 投影属于增强层，必须离开 `completed` 关键路径；翻译是否也后置留到看到真实耗时再决定。
3. project 的同步 UMAP 是必须修的系统性缺陷，否则新鲜处理验收在第一集完成后就会复现 Mac 时代的 stalled 风暴。
4. 没有阶段时间戳就没有北极星；本轮补上并在真实处理中读出第一组数字，作为后续决策（provider、翻译后置、分页）的依据。
5. 公开暴露（cloudflared 主机名、Clerk 实例）不在本轮：先让本机链路在真实处理上通过再谈外部用户。
