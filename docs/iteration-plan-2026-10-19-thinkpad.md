# NanoSparks 2026-10-19：ThinkPad 首集可读——真实链路验收与关键路径瘦身

状态：执行中。用户已授权在 argus-thinkpad 上研究、形成方案并落地，包括付费 provider（Deepgram、LiteLLM 网关 `auto`）的真实处理。模型接入遵守 `~/.claude-code-router/gateway/THINKPAD-MODEL-CONFIG.md`。本轮不包含公开主机名暴露、外部用户招募、历史证据批量修复。

## 目标裁决

保留"提交 → 说话人归属 → 阅读 → 证据回跳"主流程，不加功能。本轮目标是让这条链路在 ThinkPad 上**真实跑通一次新鲜处理并被度量**，同时拆掉会让它在第一集完成后就自毁的两个结构问题（内联 embedding、同步 UMAP）。业务验收（10 位外部读者、首集 P50 < 10 分钟、D7 ≥ 2 人）仍不因本轮工程完成而通过；本轮只交付测量它的能力和第一组真实数字。

调研依据：`docs/research/2026-10-19-thinkpad-launch/community-and-pipeline-research.md`。上轮基线：`iteration-plan-2026-09-08.md`、`iteration-delivery-status-2026-09-09.md`、`next-release-acceptance-2026-09-09.md`。

## 当前证据与判断

- VERIFIED：模型接口已按 THINKPAD-MODEL-CONFIG 打通（LLM=网关 `auto`、embedding=本地 bge-m3 `127.0.0.1:17580`、ASR=Deepgram、yt-dlp 经 mihomo、ffmpeg 静态二进制），§6 自检全过；见 2026-10-19 接入记录（memory `nanosparks-thinkpad-deploy`）。
- VERIFIED：analyze 内联 embedding 在本机耗时 6–7 分钟/对话，位于 `completed` 之前。
- VERIFIED：project 任务同步 `umap.fit()` 覆盖整个 corpus（最大 58,409 TU），是 Mac 时代 260 个 project + 175 个 analyze stalled 的根因；worker 单进程共享事件循环。
- VERIFIED：Redis 存量失败/孤儿任务 ≈ 720 个，全部早于 2026-09-06。
- VERIFIED：无阶段时间戳；健康端点隐藏 Redis 故障、漏 5 个队列；无 ThinkPad 发布脚本。
- UNKNOWN：ThinkPad 上一集真实的下载/转写/分析/翻译耗时与成本；Deepgram 归属质量；Next 生产构建在 7 GB 内存上的可行性。

## 本轮架构和模块边界

1. **embed 队列**（A）：新增 `embed` 队列与 worker（concurrency 1）。analyze 完成抽取后只入队 `embed`（jobId `${conversationId}-embed`，幂等），不再内联等待；`completed` 与导读不依赖 embedding。embed 任务完成后再入队 `project`，保证 atlas 永远基于已落库的向量。embedding 失败只影响语义检索与 atlas，不回滚 `completed`，并在 worker 日志中以 error 级别可见。入口：`src/lib/queue/jobs/embed.ts`、`src/lib/queue/config.ts`、`src/lib/queue/worker.ts`、`src/lib/queue/jobs/analyze.ts`。
2. **阶段时间戳**（B）：`Conversation` 新增 `transcribedAt`、`analyzedAt`，分别在状态进入 `transcribed` / `completed` 时写入（transcribe、normalize-turns、analyze 三处写点）。新增只读脚本 `scripts/ops-latency.ts` 输出最近 N 天"提交→可读"、"可读→导读"的 P50/P90。不回填历史。迁移：`prisma/migrations/20261019090000_conversation_stage_timestamps`。
3. **project 防冻结**（C）：`projectPoints()` 改用 `umap.fitAsync()`（每个 epoch 让出事件循环）；`projectCorpus()` 以 `PROJECT_MAX_POINTS`（默认 4000）为上限做确定性抽样并记录 warn。这是弱算力下的明确取舍：超大 corpus 的 atlas 只投影抽样点，但 worker 不再被冻结。入口：`src/lib/embeddings/projection.ts`。
4. **健康端点如实**（D）：`/api/health/worker` 覆盖 worker 注册的全部 8 个队列，增加 `waitingChildren`；Redis 不可达时返回 503 与错误信息，不再伪装成空队列。入口：`src/app/api/health/worker/route.ts`。
5. **队列清理**（E）：`scripts/redis-export-stale-jobs.ts` 先把全部 failed 与 waiting-children 任务（id、name、data、failedReason、时间）导出到 `.omo/evidence/2026-10-19-iteration/`，再清理；记录前后计数。只清理 2026-09-06 之前的存量，不触碰本轮新任务。
6. **ThinkPad 发布脚本**（F）：`scripts/deploy-thinkpad.sh`：源码同步到隔离目录（复用 node_modules）→ `prisma generate` → `next build` → 原子替换 `.next` → `systemctl --user restart` app 与 worker → 显式 HTTP 状态门禁（`/api/health` 200、`/api/health/worker` 200 且 `redisOk`）→ 失败即非零退出并保留上一版 `.next`。取代 macOS 专用的 `deploy-prod.sh`（保留不删）。

各项文件不重叠，A 与 B 共同触及 `analyze.ts` 的不同函数；先 A 后 B 串行落地。

## 验收门禁

- T1（embed 后置）：analyze 完成时不等待 embedding；embed 任务独立完成并写入 `embeddings`；人为让 embedding 服务不可用时 `completed` 不受影响且日志有 error；同一 conversation 重复入队不产生重复任务。
- T2（时间戳）：新处理的对话 `transcribedAt ≤ analyzedAt`，二者非空；`ops-latency.ts` 能输出分位数。
- T3（防冻结）：对现有最大 corpus 触发一次 project，期间 worker 其他队列可继续领取任务（观察 `/api/health/worker` 的 active 变化与日志无 stalled）；任务在 `lockDuration` 内完成或分段让出。
- T4（健康端点）：Redis 正常时返回 8 个队列计数；人为断开 Redis（或指向错误端口）时返回 503。
- T5（清理）：导出文件存在且条数等于清理前计数；清理后 failed/waiting-children 全为 0；本轮新任务不受影响。
- T6（发布）：`deploy-thinkpad.sh` 在 ThinkPad 上完整执行退出 0，记录构建耗时与峰值内存；app 与 worker 重启后健康门禁通过；`npm run lint`、`tsc`（排除既有的 `@/proxy` 测试错误）、相关单测通过。
- T7（真实新鲜处理）：通过真实 `POST /api/ingest`（Clerk 会话）提交 1 个未缓存的 YouTube 英文单集与 1 个未缓存的小宇宙中文单集，要求 `cached:false`；记录每集的下载/转写/可读/导读/embedding/翻译各阶段时间戳、Deepgram 分钟数、网关 token 与成本；阅读器 API 读回话轮、说话人、导读与证据。未跑的来源矩阵（Apple×2、RSS、B站、MP3）明确保留为未验收。

## 不做

公开主机名与 Clerk 生产实例；外部用户招募与留存统计；翻译后置（先拿到真实耗时再决定）；历史 314 条证据候选的批量修复；`mcp/` 子包迁移；Next 全站 Cache Components；embedding 换云端模型（需 infra 侧决定并重嵌 159k 向量）。

## 后续顺序

T1–T6 通过后执行 T7。T7 的数字决定下一轮：若"提交→可读" P50 已 < 10 分钟而"可读→导读"远超，则下一轮把翻译后置并评估抽取窗口并发；若下载是瓶颈，则评估代理出口；若 Deepgram 归属质量不足，再比较 Bailian paraformer（需网关外直连的单独决定）。公开暴露与外部读者在 T7 稳定后另行裁决。

## 记录

（执行中追加。）

## 记录（执行中追加）

### 2026-10-19 实现与验证

- A–D 全部落地；lint 0 错误、tsc 仅剩 3 条既有的 auth-proxy 测试错误、相关单测（pipeline/queue/api/embeddings，143 条）通过，两处断言按新契约更新（completed 数据对象、队列数 8→9）。
- 迁移：生产库 _prisma_migrations 与磁盘迁移历史漂移（7 月 24 日后 7 个迁移未登记但对象已存在，系 db push/导入所致）。经 prisma migrate diff 确认仅缺新列后，resolve --applied baseline 旧迁移并 deploy 新迁移；migrate status 报告 up to date。
- T3 预检：4000×1024 随机向量 UMAP 13s，事件循环最大停顿 5.2s（同步 kNN 初始化段）≪ 300s 锁。
- E：导出 657 failed（含 29 孤儿）+111 waiting-children 到 evidence 后清理。**副作用**：第一版先删子任务导致 7 月的 flow 父任务被解锁执行（一个真实对话开始了重抽取）。已止损（1 次 LLM 调用 bash.0003、306 Turn glossary 改写、TU 未替换）、状态复原、脚本改为先删父任务并注明必须停 worker。详见 .omo/evidence/2026-10-19-iteration/redis-cleanup-side-effect-2026-10-19.md。
- F：deploy-thinkpad.sh 两次被门禁拦下（scripts 类型错误；/api/health/worker 被 Clerk 中间件 401——已将其加入公开路由，作为 Prometheus 抓取端点本应公开）。第三次发布成功：隔离构建 95s、原子替换、双单元重启、健康门禁通过，回滚点 .releases-prev/next。
- T1/T3/T4 运行时验证通过：embedding 服务宕机时 embed 任务独立失败（对话保持 completed）、恢复后补齐并自动触发投影；真实 corpus 3411 点投影 37s 完成、无 stalled；Redis 暂停 → /api/health/worker 4.0s 内 503 + redisOk:false，恢复后 200（9 队列 + waitingChildren）。
- T7 进行中：真实 POST /api/ingest（Clerk 会话）提交 YouTube _qRv_CveLik（59min EN）与小宇宙 6a8472b95aeb2a5712e8de78（70min ZH），均 cached:false。下载 16s/（yt 经代理）；Deepgram 28–31s 完成；normalize 在无 pyannote 环境按设计走"无 L1 分离"路径。首个发现：**90s 默认 LLM 超时掐掉约一半抽取调用**（网关侧 16–111s 正常完成，auto 路由到 qwen3.7-max/kimi-k3 等大输出模型）→ 已设 NSP_LLM_TIMEOUT_MS=240000 并经 stalled 恢复重跑。

### 2026-10-19 T7 结果（截至 06:45 CST）

- 提交→可读：yt-en 3.25 min（下载 2m13s 经代理、Deepgram 31s、normalize 30s）、xyz-zh 1.25 min（16s/28s/30s）。DB 时间戳为准。
- 可读→导读：四次抽取尝试量化出三层瓶颈——客户端 90s 超时（已改 240s）、每窗 maxTokens 8192 被写满（4–8k token/窗，86–178s）、网关 120s 请求超时且裸名无 fallback（切 qwen3.8-flash 失败，已恢复 auto）。第五次运行（runId cmveeqwgn… / cmveeqxpe…）在后台继续，完成后以 t7-*-final.json 与 ops-latency.ts 为准。注意 reextract 的 BullMQ jobId 形如 retry-<cid>-<ts>，清理 active 孤儿时按此匹配。
- 交付状态文档：docs/iteration-delivery-status-2026-10-19.md。T7 导读层以 IN PROGRESS 记录，不作完成声明。
