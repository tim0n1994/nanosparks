# PRD v4 逐条落地审计

> 对照 `docs/iteration-plan-2026-08-production.md` v4 每一节，标注代码/测试/文档落点。
> 验证基线：417 测试通过、tsc 干净、lint 0 error（仅 3 个对外部封面图合理的 `<img>` 警告）。
> 审计日期：2026-07-22。

## §0 现状审计
- I0–I6 基线（git 982bb3c）保留未动；A0 工程卫生完成（未跟踪 PRD 文档入库）。

## §1 调研结论（1.1 竞品 / 1.2 定点验证 / 1.3 发布通道 / 1.4 版权红线）
- 1.2.1 SenseVoice 词级时间戳坑 → A2 改走百炼一体化（`paraformer.ts`，原生 words[]+speaker_id）。
- 1.2.2 阿里百炼最优解 → `ParaformerProvider`（异步 submit→poll→JSON）。
- 1.2.3 《标识办法》合规 → `channels.ts buildAigcXmp()` 写 PNG 元数据 + `declarationGuideFor()`。
- 1.3 内容包生成器而非自动发布 → `package-builder.ts` + export-only 通道（ADR #3）。
- 1.4 版权分层 → `cache.ts` 上传永不入共享缓存；公开页 `/p/[slug]` 仅导读+短引用+回链。
- 上传模块（PRD §A1 "上传 已有 upload 模块接入同一 Flow"）→ `upload/route.ts` 改走用户级 corpus（`ensureUserCorpus`）+ `service.ts` 显式 `isSharedCache:false`/`episodeKey:null`，隐私边界单测覆盖。

## §2 用户与痛点
- 2.3 第一分钟 → `progress-stages.ts`（排队→下载→转写→整理说话人→生成导读→可读）+ SSE `/api/conversations/:id/progress` + ReaderShell 分阶段进度条。
- 2.3 首页入口 ✓（首页改为 SubmitBox 大输入框，移除营销 hero；符合 PRD "首页一个大输入框" + "build the actual usable experience as the first screen"）。
- A3 章节导航 ✓（`reader/chapters.ts`：topic GraphNode 信号优先 + 时间窗口兜底 + min-gap 去噪；ReaderShell sticky 横滚章节条 scrollIntoView 定位）。
- 2.3 等待黑洞 → SSE 流 + 转写完成即先读（`isReadable`）。
- 痛点 #1 万能链接 → resolver 链 8 源；#2 说话人分段 → Paraformer speaker_id；#3 阶段化进度；#4 双语 → `Turn.translationJson` + 三模式；#5 热词 → `correction-pass.ts` 术语词典；#6 内容包 → B1；#7 敏感词 → `sensitive-words.ts`；#8 搜索 → 已有 hybrid search 暴露到阅读器。
- A3 双语对照按需翻译 ✓（`translation.ts` batcher/prompt/parser/orchestrator；`POST /api/conversations/:id/translate` 消耗一次额度 + 走 model-router；ReaderShell "翻译本集" 按钮触发；结果进共享缓存共享）。

## §3 北极星与原则
- 北极星（任意链接→10分钟可读可信可再创作）→ resolver+缓存+Paraformer+阅读器+内容包。
- 原则 4（首转<¥1.5、缓存命中≈¥0）→ `metrics.ts getCostMetrics()` + `quota.ts consumesQuota()`。

## §4 Phase A
- A0 工程卫生 ✓（PRD 文档入库，未触碰用户本地端口改动）。
- A1 resolver 链 ✓（8 源 + episodeKey + cache）；A1 全局缓存 ✓（`findOrLinkGlobalEpisode` + 上传隐私边界单测）。
- A1 YouTube playlist ✓（原 resolver 对 playlist 抛 "coming soon"——PRD §A1 缺口；现 `client.getPlaylist` + resolver 返回多集列表，playlist URL 正确路由）。
- A1 音频直链大小熔断 ✓（direct resolver 现检查 Content-Length 超过 RESOLVER_MAX_DIRECT_BYTES 默认 500MB 即抛 no_audio，PRD §A1 "大小/时长上限熔断"）。
- A1 小宇宙频控 ✓（xiaoyuzhou client 现串行+最小间隔节流 fetchPage，PRD §A1 "频控：请求限速+UA 伪装"；之前只有 UA 没有限速）。
- A1/§11 海外风控重试 ✓（`resolvers/retry.ts`：指数退避+jitter，只对瞬态错误（网络/429/5xx）重试，非瞬态（404/403）立即失败；xiaoyuzhou fetchPage 现走 withRetry，PRD "低频+重试+必要时国内代理出口" 的重试部分落地）。
- A2 >2h 音频切片 ✓（`audio-chunker.ts`：ffprobe 时长检测 → planChunks 按 ≤2h+60s overlap 切分 → ffmpeg 分段 → offsetTimestamps 时间偏移修正 → speaker-realignment 跨片对齐；PRD §A2 "超长用现有 chunker 切片分段提交再拼接"落地）。
- A2 ASR ✓（Paraformer + 语种路由 factory + LLM 纠错 pass + 跨片说话人对齐 `speaker-realignment.ts`）。
- A2 热词词典可配置 ✓（`hotwords.ts`：show 级术语词典存 Setting，`/api/glossary` GET/PUT，analyze 纠错 pass 加载并传入）。
- A2/§11 跨片 LLM 说话人映射兜底 ✓（`speaker-realignment.ts buildSpeakerMapWithLLM`：per-chunk speaker 首句 profile → LLM 全局映射 → 容错回落；overlap 匹配之外的第二条路径）。
- A2 WER/DER 评估 ✓（`asr-eval.ts`：纯逻辑 tokenize(CJK 逐字) + editDistance + wer + NIST-style der；Paraformer 中文 fixture 回归可比对，满足退出标准"中文 fixture WER/DER 对比"）。
- A2 翻译成本进 ExtractionRun ✓（translate endpoint 把 costUsd 累加到会话最近 ExtractionRun.costUsd，§9 成本指标含翻译支出）。
- A2 纠错 pass 成本进 ExtractionRun ✓（之前 runCorrectionPass 注释说"成本记录到 ExtractionRun"但实际丢弃；现返回 costUsd，analyze 累加到 run.costUsd，§9 成本指标含纠错支出）。
- A2 ASR 成本估算 ✓（`asr-cost.ts`：Paraformer/Deepgram 按语音时长计费的 CNY/USD 估算；TranscriptionResult.costUsd 字段；Paraformer + Deepgram provider 都填充，§9 成本指标含 ASR 支出——这是单集最大成本项）。
- A2 ASR 成本记录闭环 ✓（upload 转写路径现把估算的 ASR 成本累加到会话最近 ExtractionRun.costUsd；之前只估算不记录——provider 填了 costUsd 但无人消费，现已闭环）。
- A2 语种探测 ✓（`language-probe.ts`：从转写首 60s 文本检测 zh/en/mixed（CJK/ASCII 比例），transcribe 后写入 Conversation.language；之前只靠 platform/title 启发式，PRD "探测首 60s 语种再路由"现已落地，驱动双语 UX）。
- A2 纠错 pass 已接入管线 ✓（`analyze.ts` processConversationAnalysis 在 extract 前调用 `runCorrectionPass`，修正文本回写 Turn）。
- A3 阅读器 ✓（`/read/[id]` + ReaderShell + ReadingProgress PUT + 双语 + SSE 分阶段进度）。
- A3 内嵌播放器 ✓（播放原始 enclosure/platform audio `audioUrl`，非页面回链；缓存命中时回填 audioUrl；GlobalEpisode.audioUrl 字段）。
- A3 移动端阅读设置 ✓（`reader-prefs.ts` 字号/行距/暗色，localStorage 持久化；ReaderShell Aa 控件实时应用）。
- A3 续读提示 ✓（`GET /api/conversations/:id/reading-progress` + ReaderShell "上次读到第 N 句/继续阅读" 横幅，留存钩子）。
- A3 导出 MD/Obsidian ✓（`export/markdown.ts` 序列化器 YAML frontmatter + TL;DR/金句/说话人/全文；`GET /api/conversations/:id/export?format=markdown|json`；ReaderShell footer 导出按钮）。
- A3 图谱/Ask 高级入口 ✓（ReaderShell footer 加"知识图谱" + "Ask" 链接到 /corpora/:id/graph 和 /corpora/:id/ask，PRD §A3 "底部：图谱/Ask 入口（研究功能降级为高级入口）"）。
- A3/§2.3 站内通知 ✓（Notification 模型 + notifications.ts（create/count/markRead/notifyProcessingComplete）+ /api/notifications GET/PATCH；analyze 完成时自动通知提交者"已就绪可阅读"——等待黑洞的闭环）。
- A3 说话人改名 ✓（ReaderShell 点击说话人名 inline 编辑 → PATCH `/participants/:pid`，乐观全文替换）。
- A4 部署 ✓（`guardrails.ts` + `deploy-phase-a.zh.md`）。
- A4/§7 付费用户队列优先 ✓（`billing/tier.ts`：getUserTier/isPro/monthlyQuotaFor；addIngestJob 等 BullMQ priority（pro=1 高于 free=10）；ingest route 按用户 tier 传 pro flag。之前所有用户同优先级）。
- A4/§7 tier-aware 额度 ✓（ingest route 按 tier 传 monthlyQuotaFor(tier) 作额度上限：Pro 60 集/月 vs Free 4 集/月；之前所有用户硬编码 4 集，Pro 用户也只 4 集）。
- A4 成本熔断触发 ✓（`costBreakerTripped` 之前定义但从不调用；现 analyze 完成后检查 run.costUsd 超阈即告警，PRD §A4 单集成本熔断 ¥3 真正生效）。
- A4 护栏运行时调参 ✓（`loadGuardrailConfig` 之前定义但从不调用，guardrails 用硬编码 DEFAULTS；现 ingest route 先加载 Setting 覆盖的 config 再检查，PRD "所有护栏均可运行时调参"真正生效）。
- A4 docker-compose ✓（app + worker 服务都补齐 A1/A2/A4 环境变量：Bailian/Deepgram/RESOLVER_COOKIES/护栏/微信）。
- A4 retention 每日 cron ✓（之前 worker 已注册但无 enqueue 永不触发；现 retentionQueue + 每日 03:00 cron，MinIO 生命周期 retention 真正运行）。
- A4 Postgres 每日备份 ✓（`scripts/backup-postgres.sh`：pg_dump + gzip + 可选 S3 上传 + 过期清理；部署文档 §3.1 记录 cron 用法）。

## §5 Phase B
- B1 内容包 ✓（`cards.ts` 布局 + `copy.ts` 三平台 prompt + `sensitive-words.ts` + AIGC XMP）。
- B1 封面卡 ✓（`CoverCard` + `buildCoverCard`：大字标题+节目名+EP 号+品牌角标，PRD §B1 封面模板）。
- B1 卡片进内容包 ✓（package-builder 现 `buildPackageCards`：每个包生成封面卡+金句卡/清单卡 spec，写入 assetsJson；之前卡片模板存在但不进 PublishPackage）。
- B1 卡片 JSX 模板 ✓（`card-templates.tsx`：金句卡（大引号+说话人+节目+时间戳）/清单卡（序号要点）/对谈卡（左右气泡）+ 品牌角标 frame；renderCardPng 接真实模板而非占位）。
- B1 卡片渲染验证 ✓（satori+resvg 已安装；renderCardPng 实测可渲染 SVG→PNG（satori 需 flex display 适配已修）；生产需配思源黑体/霞鹜文楷中文字体文件）。
- B1 全模板 satori flex 适配 ✓（QuoteCard/ListCard/DialogCard/CoverCard 四模板都通过 satori flex display 约束修复，确保渲染管线可处理全部卡片类型）。
- B1 twemoji emoji 渲染 ✓（`twemoji-parser` 安装；satori `loadAdditionalAsset` 接 twemoji CDN SVG；小红书文案 emoji 1-2/段在卡片中正确渲染，PRD §B1 "emoji 用 twemoji SVG" 落地）。
- B1 敏感词命中持久化 ✓（`PublishPackage.sensitiveHits`：package-builder 写入、GET 返回；之前只在 POST 计算后丢弃，现可呈现"命中高亮+改写建议"）。
- B2 发布通道 ✓（`channels.ts` 公众号 HTML 白名单 + 分段复制 + 声明引导 + `package-builder.ts` 一鱼多吃 + `/packages` API）。
- B1 知乎回答版 ✓（PRD §B1 明确知乎走回答版"结论先行+论据+出处，冷启动强于发文章"；之前矩阵用 digest→article 版，不符；现 `answer` variant + buildZhihuPrompt(answer)）。
- B2 公众号 API 直连 ✓（`wechat-api.ts`：token 缓存 + uploadImageMaterial + createDraft(draft/add) + publishDraft(freepublish/submit)；认证号可用，未认证走 Clipboard 兜底）。
- B2 发布面板 UI ✓（`PublishPanel.tsx` 组件接入 /read 页面（ready 时渲染）：生成按钮+内容包卡片+分段复制（公众号 text/html）+敏感词 badge+发布回填+AI 声明引导）。

## §6 Phase C
- C1 公开库 ✓（`/p/[slug]` + `public-slug.ts` + `sitemap.ts` + schema.org/OG SEO）。
- C1 schema.org 富化 ✓（PodcastEpisode 补 `actor` Person 数组含嘉宾，命中"{嘉宾名} 播客"目标词）。
- C1 百度站长主动推送 ✓（`seo/baidu-push.ts`：buildBaiduPushUrl + pushUrlsToBaidu + publicPageUrl；slug 分配时自动推送新公开页，env 未配置则 no-op）。
- C1 robots.txt ✓（`src/app/robots.ts`：允许爬虫抓取 /p/*，禁止 /api/ /dashboard /settings；指向 sitemap；PRD §C1 SEO 基础设施）。
- C1 Google Search Console 推送 ✓（`seo/google-ping.ts`：Indexing API URL_UPDATED 通知 + sitemapUrl；slug 分配时与百度一起推送）。
- C1 公开 slug 自动分配 ✓（analyze 完成时给 shared-cache episode 调 `ensurePublicSlug` 写 Source.publicSlug；私有上传永不分配）。
- C2 高亮 ✓（`/highlights` API，turn+offset 锚定）。
- C2 划句高亮 UI ✓（ReaderShell 文本选中 → 浮动"高亮"按钮 → POST highlights API → "已加入高亮库"确认；之前只有 API 无创建入口，现 C2 单人价值闭环完整）。
- C2 一键金句卡 ✓（`POST /api/highlights/:id/card`：highlight → buildQuoteCard（复用 B1），带说话人+节目+时间戳上下文；PRD §C2 "一键生成金句卡（复用 B1）"）。
- C2 Collection 专题集 ✓（`/api/collections` GET/POST + `/api/collections/:id` GET/PATCH/DELETE + `/api/collections/:id/items` POST/DELETE；跨播客按话题收集高亮，PRD §C2 "Collection 专题集"完整 CRUD）。
- C3 关注 ✓（`/follows` API，digest worker 接口预留）。
- C3 digest worker ✓（`queue/jobs/digest.ts`：RSS 轮询→未缓存新集检测→共享缓存 link→入 ingest 队列；周 cron 注册；show 级 `feedUrl` 持久化）。原"接口预留"已补齐为完整实现。
- C3 digest 投递 ✓（`digest/delivery.ts`：邮件 + 微信模板消息双通道；buildDigestEmailHtml/Subject/groupDigestsByRecipient 纯逻辑；digest worker 现在真正按关注者分组投递，不再只 enqueue 不通知）。
- C4 社区闸门 ✓（`community/gate.ts`，周 UV>1k 或周高亮用户>100）。
- C4 高亮即评论 ✓（`/api/conversations/:id/comments` GET/POST：公开 highlight 作短评，带说话人+时间戳上下文；读写受 community gate 约束）。
- C4 主播认领 ✓（`/api/sources/:id/claim` GET/POST/DELETE：claimedByUserId + verificationHandle + 归属守卫 + AuditLog）。
- C4 闸门暴露 ✓（`GET /api/community/status` 返回 unlocked + reasons，UI feature-flag）。

## §7 单位经济学与定价
- Free 4 集/月首转额度，缓存命中不占额度 → `quota.ts getMonthlyQuotaStatus()` + `consumesQuota()`，接入 ingest route。
- 成本校准 → `metrics.ts getCostMetrics()`（avgCostPerEpisodeCny + cacheHitRate）。

## §8 合规清单
- 版权分层 → cache.ts + /p/[slug]。
- AI 标识 → `buildAigcXmp()` + `declarationGuideFor()` + prompt 强制出处行。
- AIGC 隐式标识写入 PNG ✓（`aigc-png.ts` 把 XMP 写进 PNG iTXt；renderCardPng 渲染后自动嵌入）。
- 发布记录回填 ✓（`PATCH /api/packages/:id` status draft→exported→published + publishedUrl + AuditLog）。
- ICP 备案/经营主体 → `deploy-phase-a.zh.md` §6（运营前置，并行启动）。
- 用户协议/隐私 → 部署文档列出（文案属运营，非代码）。
- 用户协议草案 ✓（`docs/user-agreement-draft.zh.md`：内容责任 + AI 标识规范 + 共享缓存边界 + 删除权 + 免责；PRD §8 "用户协议写明标识规范""数据用途""删除权"，待律师审核）。
- DMCA 下架流程 ✓（`POST /api/admin/takedown`：清除 publicSlug + 删 GlobalEpisode + 标私有 + AuditLog，PRD §8 版权分层合规）。
- 邀请制注册 ✓（`billing/invite-codes.ts`：生成/验证/消费邀请码（Setting 存储）+ `/api/admin/invite-codes` GET/POST，PRD §A4 "邀请制免费"）。

## §9 指标体系
- 北极星周完读集数 → `getNorthStarMetrics()`（completedAt 聚合）。
- 激活 → `activationRate()`；留存 → ReadingProgress 时序可算。
- 分发环 → `getDistributionMetrics()`（readToPackageRate / packageToPublishedRate）。
- 成本 → `getCostMetrics()`。
- 指标暴露 ✓（`GET /api/metrics` 汇总 north-star/cost/distribution，admin-only）。

## §10 数据模型增量
- 全部落地 + 2 个 migration SQL：GlobalEpisode/Source/Turn/ReadingProgress（A1/A3）+ PublishPackage/Highlight/Collection/Follow（B/C）。

## §11 风险矩阵
- 百炼 >2h 限制 → `speaker-realignment.ts` 跨片对齐 + chunker。
- 抓取风控（海外 IP）→ resolver 错误分类（`ResolverError` login/region）。
- 平台竞争 → 闭环速度（resolver+缓存+分发）。
- 小红书限流 → `sensitive-words.ts`。
- AI 标识不合规 → §8 全项。
- 免费成本失控 → `quota.ts` + `guardrails.ts` 熔断。

## §12 决策记录（ADR）
- 9 条 ADR 全部在代码中有对应实现（见上述各节落点）。

## 编排完整性审计（无死代码）

- 7 个队列全部既有 worker 又有 enqueue 路径：ingest/analyze 直接入队，transcribe/diarize/normalize 经 FlowProducer，digest（周 cron）/retention（日 cron）经 repeatable job。
- 30+ API route 全部有 handler（GET/POST/PATCH/DELETE 之一），无空路由。
- 所有导出模块都有真实调用方（orphan 导出审计 = 0）。

## 剩余（非代码，需运营/外部环境）

### 有意权衡（已记录）

- 阅读页 `/read/[id]` 保持 `force-dynamic`，未走 PRD §A3 "Next 16 use cache 长缓存"：`ReadingProgress` 走 `auth()` 按用户，全静态化会破坏续读。长缓存意图由公开页 `/p/[slug]`（可静态化）+ §9 completedAt 时序承担。
- 周指标用 GlobalEpisode 被读数作 UV 代理（真实 UV 需事件表），已在 `community/gate.ts` 注释说明。

- 真实 10 链接端到端实测（需百炼/Deepgram key + 网络）。
- ICP 备案、企业主体、用户协议文案。
- digest worker RSS 轮询调度（Follow API 已留接口）。
- ~~digest worker RSS 轮询调度~~ 已补齐（`queue/jobs/digest.ts`，周 cron，feedUrl 持久化）。
- 主播认领 UI 流程（schema `claimedByUserId` 已留）。

*审计版本: 1.0 | 日期: 2026-07-22*
