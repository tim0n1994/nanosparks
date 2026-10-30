# NanoSparks 被阻塞目标深度研究与处置报告

日期：2026-09-06 ｜ 调研方式：只读（代码 + git + session 日志 + 运行态探针 + docker/lsof/launchctl）｜ 唯一写入口：本文件

研究对象：Codex 目标（线程 019f887d-649e-76f1-a3d6-f6da24f41f02，2026-07-23 创建，blocked 45 天，session 文件 `/Users/username/.codex/sessions/2026/07/22/rollout-2026-07-22T14-22-27-019f887d-649e-76f1-a3d6-f6da24f41f02.jsonl`）。

目标原文：「用superpower skill看看整个链路上哪些有问题，在前端上如何高级的的反应分析和处理的进度，所有的前端细节要充分挖掘能力，做好功能的各个细节，打通链路后跑这个链接进行测试 https://www.youtube.com/watch?v=knx2wrILP1M，根据结果再检测链路，不能懈怠，直到链路和前后端能力优化到极致」

证据分级：VERIFIED=本次直接观察；MEMORY=记忆档案中当时已验证（本次无法或未重复验证）；INFERRED=强推断；UNKNOWN=未确证。

---

## 1. 目标解读与项目现状

### 1.1 目标解读

目标可拆为四个子目标：(a) 全链路问题检查；(b) 前端对处理进度做「高级的」分析与展示；(c) 充分挖掘前端细节能力；(d) 用 https://www.youtube.com/watch?v=knx2wrILP1M 打通并测试链路，按结果迭代优化到极致。核心验收锚点就是这条例外链接的端到端跑通。

### 1.2 knx2wrILP1M 在链路中的用途（关键定位）

- VERIFIED（session log L7834）：2026-07-22 21:45Z 用户报障原文「我刚测试，输入 https://www.youtube.com/watch?v=knx2wrILP1M 这个播客链接，显示 Internal error。定位根因，解决」——它是 /submit → ingest → yt-dlp 下载 → transcribe → analyze 链路的真实用户输入，也是触发本目标的 e2e 测试载体，不是随便挑的样本。
- VERIFIED（src/scripts/enqueue-transcribe.ts:6-10）：dev 重排工具，向 transcribeQueue 直接添加 `{conversationId: 'cmrwrwvjy001x7eyfwigm3z70', audioPath: '/tmp/nanosparks-audio/knx2wrILP1M.mp3'}`，即跳过 ingest 对该集重排转写；由 commit 5666efb（2026-07-23「fix: LLM endpoint format + Zod v4 structured output + worker stability」）引入，是目标线程当天自己的测试载体。
- VERIFIED（src/lib/queue/pipeline-watchdog.ts:56-68）：yt-dlp 下载产物按 YouTube videoId 命名，watchdog 通过 episodeKey `youtube:<videoId>` 回找音频——与 `/tmp/nanosparks-audio/knx2wrILP1M.mp3` 的命名互相印证。
- 视频标题：UNKNOWN（两次 web 检索结果互相矛盾、来源不可靠，不作采信）；INFERRED：用户称其为「播客链接」，应为播客单集。

### 1.3 链路与前端能力现状（file:line）

入口修正（VERIFIED）：任务描述所称 `scripts/selfcheck.mjs` 与根目录 README.md 均不存在（`ls`/`ls README*` 确认）；规范启动入口是 `bash scripts/up.sh`（MEMORY：拉起 Docker Postgres/Redis + embedding/worker/web launchd 全栈）；当前交付门禁为 AGENTS.md:14 `npm run verify`（type-check → lint → test --run → build → verify:design），AGENTS.md:16 要求交付前完整执行、不得只凭单测绿宣称通过。

- 队列拓扑（VERIFIED）：src/lib/queue/config.ts:4-20 定义 8 条队列（ingest/transcribe/analyze/diarize/normalize_turns/retention/project/person_profile）；src/lib/queue/worker.ts:36/44/57/65/73/90/98 并发为 ingest 2、transcribe 3、analyze 2、diarize/normalize/project/person_profile 各 1；worker.ts:108-119 retention 每日 03:00 Asia/Shanghai cron。
- 前端进度能力=目标 (b) 已落地（VERIFIED）：src/lib/progress-stages.ts:2-11 分阶段文案「下载中 → 转写中 → 整理说话人 → 生成导读 → 可读」；:26-40 ProgressDetail 含 elapsedMs/etaMs/turnCount/thoughtUnitCount；:50-56 基于实测时长（76 分钟集：下载~20s、转写~4min、分析~2min）给出真实 ETA 而非无限 spinner。
- 前端聚合与降级（VERIFIED）：src/app/dashboard/page.tsx:20-31 全表状态统计；:33-46 展示 transcribe/analyze 队列深度，Redis 不可用时 catch 降级、统计仍渲染；:48-63 按频道分组进度。
- 自愈（VERIFIED）：src/lib/queue/pipeline-watchdog.ts:20-21 每 2min 检查、transcribing 超 10 分钟判 stuck；:76 起 watchdogTick 对 stuck 会话 requeue/reset，且队列仍有 active/waiting 时不误杀。
- 指标（VERIFIED）：src/lib/metrics.ts:4-8 North star=周完读集数（scrollRatio≥0.7 或 dwell≥3min），:21-33 基于 ReadingProgress.completedAt 聚合。
- E2E（VERIFIED）：e2e/ 含 dashboard/health/homepage/ingest/reader-l0/reader/share/submit/visualization 共 9 个 spec，覆盖目标关心的 submit→reader 前端链路。

### 1.4 07-23 之后的实质进展（VERIFIED git log，2026-07-23～08-01）

894b357（lockDuration 30s→5min 防 extraction 误判 stalled）、8385881（GLM 529 限流三层对策）、eac82bb/009632e/9507f71（LLM 端点与结构化输出修复）、7f75744/8788d33（英文播客自动翻译+双语对照）、e31a13b（前端可选 ASR 引擎）、6b5450d/f71ed21（多 LLM 端点设置面板）、e56c81e（导入面基 101 集+45 实体）、f77703d（无音频自动重下，不再跳 ingest）、9a9420c/e7d1ed4/76a11f5（graph 超时、话题流归一化、混合检索修复）。另有 MEMORY：npm run verify 曾达 855 passed；EP139/140 恢复后 198 completed / 0 analyzing；但 north-star 评估未闭环（无 evaluated entities、729 TU 未归属）——产品验收未完成。

### 1.5 当前运行态（VERIFIED 2026-09-06 探针）

- Web 活：node pid 2367 LISTEN *:7557；Embedding 活：llama-server 127.0.0.1:8080。
- Worker 崩溃循环：launchctl com.nanosparks.worker last exit code=1、state=spawn scheduled；worker.err.log 显示 ECONNREFUSED 127.0.0.1:16688(Redis)；worker.out.log 今日 09:45:35Z 仍打印「All queue workers started + Pipeline watchdog started」后即崩，约每 10s 被 launchd 重启。
- 数据层停摆 7 天：docker nanosparks-postgres-1 / nanosparks-redis-1 Exited(0) 7 days ago（minio Exited(255) 5 weeks）；15158/16688 无监听 → conversation cmrwrwvjy001x7eyfwigm3z70 的当前 DB 状态为 UNKNOWN（无法查询本身已 VERIFIED）。

---

## 2. 当年为何阻塞

- VERIFIED（session log L10073/L10081，rg 计 5 次）：2026-07-23 09:27–09:38Z（北京时间 17:27–17:38）连续多次 task_complete 失败，错误均为「502 Bad Gateway: Provider unreachable: unknown certificate verification error, url: http://127.0.0.1:10100/v1/responses」——本地模型代理 127.0.0.1:10100 证书校验失败、不可达。这是基础设施故障，不是项目代码问题。
- 时间线（VERIFIED）：目标 07-22 三次演进（PRD 理解 → superpowers 前端增强 → 最终全链路+knx2wrILP1M 版，07-23 07:20 CST 生效），数小时后模型代理故障，连续失败满足 blocked 审计条件，目标自此挂起。
- 线程累计 total_tokens 956,885,634（cached 951,064,192）（VERIFIED L10095 token_count）；与外部统计的 859k 计费口径差异推断为缓存计费规则（INFERRED）。

---

## 3. 是否真正需要用户决策：NO

1. 阻塞根因是本地模型代理证书故障（127.0.0.1:10100），与代码、外部账号、付费、第三方授权均无关；本任务当前经 GLM 通道正常运行，即证明阻塞条件已消除（VERIFIED：本报告即证据）。
2. 用户已明确授权「GLM token 无预算限制」并表态「很多不需要我决策，你接着做」（任务背景转述）。
3. 剩余工作全部落在既有授权内：恢复本机数据层、跑测试门禁、查询自己的 DB/队列、重跑公开 YouTube 链接的管线、补质量验收——均为运行态操作与只读检查，无外部写、无破坏性动作、无产品方向分叉。
4. 目标本身已写死验收标准（跑通该链接、按结果优化），不存在需要用户拍门的待定选项。

---

## 4. 可自主推进的具体下一步（按序）

注：以下均为恢复运行态/测试/验收动作，不修改代码与配置；本报告按任务边界未执行任何一步。

1. **恢复数据层与 worker（~10min）**：`docker compose up -d postgres redis`（等价走 scripts/up.sh 全栈入口）。验收：两容器 Up、lsof 15158/16688 LISTEN、launchctl worker exit 0 常驻、worker.out 新增「All queue workers started」且后续无 ECONNREFUSED。
2. **全量门禁 `npm run verify`（~30-60min）**：验收：exit 0，逐阶段记录 type-check/lint/test/build/verify:design 结果；与 MEMORY 基线 855 passed 对照，若有失败区分新归因 vs 环境性失败。
3. **DB/队列一致性验收（~20min）**：psql(15158) 查 cmrwrwvjy001x7eyfwigm3z70 与全表 status 分布；BullMQ 各队列 waiting/active/failed；确认 watchdog tick 正常。验收：无异常 stuck transcribing；记录该集当前状态作为重跑前基线。
4. **端到端重跑 knx2wrILP1M（~1-2h）**：优先经 /submit 正常 ingest 路径提交原 URL（覆盖下载→转写→分析全链路，比 enqueue-transcribe.ts 直排更完整）；保留该脚本作快速重排备选。验收：conversation 到 completed、turns>0 且 thoughtUnits>0、dashboard 可见且队列深度回落、reader 可读且进度阶段按 progress-stages.ts 流转（SSE 含 etaMs）。若再现 Internal error，按目标要求回到链路检测并迭代。
5. **north-star 与质量验收补全（~1h+）**：核对 metrics.ts 数据链（ReadingProgress.completedAt→getNorthStarMetrics）、补跑 northstar holdout、复核 MEMORY 所称 729 未归属 TU 是否仍存在。验收：给出周完读统计数字（本地单人环境为 0 属合理结果，需如实记录）与 TU 归属率；至此目标验收闭环。

---

## 5. 建议处置：execute

理由：阻塞是基础设施性的且已解除（502 证书错误 vs 当前 GLM 通道正常，见第 2、3 段证据）；目标实质交付度已很高（分阶段进度、dashboard 聚合、watchdog、限流对策、101 集导入等均 VERIFIED 存在）；当前唯一硬故障是数据层停摆 7 天导致 worker 崩溃循环，10 分钟可恢复；剩余工作全部可自主验收闭环（第 4 段 5 步，合计约 0.5-1 个工作日）。close 会浪费一个只差验收的目标；needs-user 没有任何真实待决问题。唯一升级条件：Step 4 重跑暴露需改代码的根因性缺陷时，按 AGENTS.md 门禁走正常变更流程再动手。
