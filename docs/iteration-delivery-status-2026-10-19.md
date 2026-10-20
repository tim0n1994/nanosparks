# NanoSparks 2026-10-19 ThinkPad 迭代交付状态

状态：工程门禁 T1–T6 通过并已发布到 argus-thinkpad；T7 真实新鲜处理**可读层完成、导读层仍在后台运行**（本文件写作时两集的第五次抽取正在 `auto` 上进行）。业务验收（10 位外部读者、首集 P50<10min、D7≥2）未开始，不因本轮完成而通过。本文件是交付清单、实测数字与剩余项；计划与门禁定义见 `docs/iteration-plan-2026-10-19-thinkpad.md`。

## Outcome

六个模块按计划交付并在线：embed 队列（embedding 出 analyze 关键路径）、阶段时间戳（`transcribedAt/analyzedAt` + `scripts/ops-latency.ts`）、projection 防冻结（`fitAsync` + `PROJECT_MAX_POINTS`）、如实的 worker 健康端点（9 队列 + waitingChildren + Redis 故障 503，已设为公开路由）、存量队列清理（657 failed + 111 waiting-children，先导出后清理）、ThinkPad 发布脚本（隔离构建 → 原子替换 → 双单元重启 → 健康门禁 → 失败自动回滚）。

上轮遗留的 G7 首次真实打通：两集（YouTube 59min EN、小宇宙 70min ZH）经真实 `POST /api/ingest`（Clerk 会话 JWT）提交、`cached:false`，**提交→可读分别 3.25 与 1.25 分钟**。导读层暴露了三层叠加的真实瓶颈（见"T7 实测"），本轮把它们量化并定位到具体代码行与网关参数，但没有在本轮改抽取逻辑。

改动保留在工作区，未提交、未合并。

## Evidence by gate

| 门禁 | 结果 | 关键证据 |
| --- | --- | --- |
| T1 embed 后置 | PASS | embedding 服务停机 → embed 任务独立失败（`fetch failed`，对话保持 `completed`）；恢复 → 11 TU 15 s 补齐并自动入队 project；jobId `<cid>-embed-<runId>` 按 run 幂等（`.omo/evidence/.../t1-embed.log`） |
| T2 时间戳 | PASS | 两集 `transcribedAt` 已写入（`analyzedAt` 待导读完成）；`ops-latency.ts` 可输出分位数 |
| T3 防冻结 | PASS | 预检 4000×1024：13 s，事件循环最大停顿 5.2 s ≪ 300 s 锁（`projection-bench-*.json`）；真实 corpus 3411 点 37 s、375 簇落库、无 stalled |
| T4 健康端点 | PASS | 9 队列 + waitingChildren + `redisOk`；Redis `docker pause` → 4.0 s 内 503 `redisOk:false`；unpause → 200（`t4-health.log`） |
| T5 清理 | PASS（含副作用） | 三份 `redis-stale-jobs-*.json`；最终 9 队列 failed/waiting-children/active/wait 全 0。副作用与处置见 `redis-cleanup-side-effect-2026-10-19.md` |
| T6 发布 | PASS | 第三次执行成功（`deploy-thinkpad-20261019T043001.log`）：隔离构建 95 s、门禁通过、回滚点 `.releases-prev/next`。前两次被门禁拦下（`scripts/` 类型错误；`/api/health/worker` 被 Clerk 401），线上未受影响 |
| T7 真实处理 | 可读层 PASS / 导读层 IN PROGRESS | 见下节；来源矩阵其余（Apple×2、RSS、B站、MP3）保留未验收 |

## T7 实测

### 提交 → 可读（DB 时间戳，权威）

| 阶段 | yt-en `cmvead0790002cg5gl2u0ae1k`（59 min EN） | xyz-zh `cmveaddcl0005cg5g6thx6xil`（70 min ZH） |
| --- | --- | --- |
| 下载 | 2 min 13 s（yt-dlp 经 mihomo，72 MB mp3） | 16 s（67 MB m4a 直连） |
| Deepgram | 31 s（226 turns，2 speakers） | 28 s（244 turns，3 participants） |
| normalize（pyannote 不可用 → 无 L1 分离） | 30 s | 30 s |
| **提交 → 可读** | **3.25 min** | **1.25 min** |

两集都远低于 10 分钟线；YouTube 的差额几乎全是代理下载。

### 可读 → 导读（进行中，瓶颈已量化）

四次抽取尝试的观测（worker 日志 + LiteLLM `LiteLLM_SpendLogs`）：

1. **客户端 90 s 默认超时掐掉约半数窗口**：网关侧调用 16–111 s 正常完成（`auto` 路由到 qwen3.7-max / kimi-k3 / qwen3.5-plus 等），客户端已先 abort → 已持久化 `NSP_LLM_TIMEOUT_MS=240000`（`.env.argus-thinkpad`）。
2. **每窗输出 4–8k token**：`src/lib/extraction/windowed-extraction.ts:219` 给窗口抽取 `maxTokens: 8192`，模型（无论旗舰还是 flash）都把它写满：输出 p50 4000（上限）～6074 token，单窗 86–178 s。68 + 117 个窗口、2 并发 → 两集导读以小时计。
3. **网关 120 s 请求超时 + 裸名无 fallback**：LiteLLM 日志 `Request timed out. timeout value=120.0`；`auto` 靠跨部署重试与别名 fallback 还能完成，裸名 `qwen3.8-flash` 则直接失败（"No fallback model group found"）。临时切到 flash 的尝试因此作废，已恢复 `auto`（删除 `routing_cloud_model` Setting）。
4. 次生现象：输出顶满上限导致 JSON 截断（5 次解析失败）、少量 ``` 围栏变体；网关每日 06:01 sync 重启窗口期间所有调用失败约 1–2 分钟。

当前第五次运行（`cmveeqwgn…`/`cmveeqxpe…`，`auto`，240 s 客户端超时；第四次因操作失误误删了在跑任务的 Redis 记录而重来）在后台继续；完成后 `t7-*-final.json` 与 `npx tsx scripts/ops-latency.ts 1` 给出完整"可读→导读"数字。此前四次运行的 ExtractionRun 已标记 failed 并在 `params.cancelled` 记录原因，不计入时延统计。

成本口径：Deepgram 129 音频分钟；LLM 按 LiteLLM 标价记录（Ali 渠道在网关记账为 0），前四次尝试合计约 $0.08。

## Verdict（下一轮决策依据）

1. 北极星的"可读"半程已达标（两集 < 4 min）；差距全部在"可读→导读"。
2. 下一轮第一优先级是抽取层的**输出预算**：把窗口 `maxTokens` 从 8192 降到能在网关 120 s 内稳定完成的量级（≈2–3k），配合提示词收紧与窗口切分；这比换模型有效，因为瓶颈是生成长度不是模型速度。
3. 需要 infra 侧决定的一项：长生成调用的网关 `request_timeout`（当前 120 s）是否按 key/模型放宽，或为批量抽取提供带 fallback 的别名。
4. 英文整集翻译仍内联在 `completed` 之前，本轮未动；待导读数字出来后决定是否后置。
5. 队列纪律已恢复可信：失败/僵尸清零，健康端点如实，project 不再冻结 worker。

## 遗留 UNKNOWN

- 两集"可读→导读"的最终时长、embedding 与翻译在新链路下的实际耗时（后台运行中）。
- 来源矩阵其余 6 类未跑；外部用户/留存未开始；公网暴露未做（cloudflared ingress 仍只有 eagleye.*）。
- 无 pyannote 时的说话人归属质量（Deepgram 自带 diarize 给出 2–3 speaker）需人工读后评估。
- Redis 清理副作用中 306 个 Turn 的 glossary 改写无 before-image。
- `src/__tests__/lib/auth-proxy.test.ts` 的 3 个 `@/proxy` 引用错误为既有问题（Next16 middleware→proxy 迁移半途）。

## Authoritative artifacts

- 计划/调研：`docs/iteration-plan-2026-10-19-thinkpad.md`、`docs/research/2026-10-19-thinkpad-launch/community-and-pipeline-research.md`
- 证据：`.omo/evidence/2026-10-19-iteration/`（`t7-*-ingest.json`、`t7-*-timeline.jsonl`、`t7-*-monitor.log`、`redis-stale-jobs-*.json` ×3、`redis-cleanup-side-effect-2026-10-19.md`、`projection-bench-*.json`、`deploy-thinkpad-*.log` ×3、`t1-embed.log`、`t4-health.log`）
- 脚本：`scripts/deploy-thinkpad.sh`、`scripts/ops-latency.ts`、`scripts/redis-export-stale-jobs.ts`；主机工具 `~/.local/bin/nsp-t7-ingest.sh`、`nsp-t7-monitor.py`、`nsp-clerk-jwt.sh`
- 配置变更：`.env.argus-thinkpad` 新增 `NSP_LLM_TIMEOUT_MS=240000`；`src/middleware.ts` 公开 `/api/health/worker`；DB 迁移 `20261019090000_conversation_stage_timestamps`（并 baseline 了 7 个未登记的历史迁移）


## 彻底修复（2026-10-19 下午，T7 续）

上表 T7 导读层 IN PROVISION 的缺口已按用户授权的 ULW 彻底修复并验证。

### 修复内容（均已上线）

1. **覆盖率放行**（`analyze.ts`）：窗口成功率 ≥ `NSP_WINDOW_MIN_COVERAGE`（默认 0.9）接受 partial 并落库，`coverage.coverageRatio/minCoverage` 记入 ExtractionRun；低于阈值仍失败。旧的"任一窗口失败即整体作废"是导读层无法完成的直接原因。
2. **失败窗口重试**：pass1 结束后对失败窗口做一轮有界重试（`NSP_WINDOW_RETRY=0` 可关），实测重试 + 放行把 116/117（99.1%）送到了 `completed`。
3. **窗口输出预算**（`windowed-extraction.ts`）：`maxTokens 8192 → NSP_WINDOW_MAX_TOKENS`（默认 3500），提示词同步收紧（≤12 TU、text ≤100 字、quote ≤60 字）。此前任何模型都把 8192 写满（4–8k token/窗、86–178 s）。
4. **JSON 救回**（`client.ts`）：新增 `salvageTruncatedJson`（按括号深度扫描，截断处回退到最后一个完整值；数组内半截元素整只丢弃）；`parseLenientJson` 第 3 步包上 try/catch 后接入救回——这一步的未捕获 throw 正是生产上 "Unexpected token" 假失败的来源；fallback 路径从裸 `JSON.parse` 改为 `parseLenientJson`；`completeStructured` 对**空 content**（渠道间歇返回 200+空体）按软失败重试。
5. **模型路由**（生产决定）：抽取与翻译固定到 `deepseek-v4.1-flash-fast`（Setting `routing_cloud_model` + `pipeline.translation.profile`）。探测数据：`fast` 别名 12.6 s/578 tok、`deepseek-v4.1-flash-fast` 4.9 s/468 tok、`qwen3.5-flash` 32.5 s/3625、`auto` 41.9 s/3500（思考型旗舰把 thinking token 计入 completion，输出顶满上限）。交互式 Ask/摘要保持默认 `auto`（质量优先）。

### 途中排除的路径（记录以免重试）

- `auto` 旗舰档：单窗 86–178 s 且 >120 s 者被网关请求超时掐死，两集 3 小时仍到不了 100% 覆盖。
- 裸名 `qwen3.8-flash`：无跨模型 fallback，>120 s 调用直接失败。
- `fast` 别名：约 1/4 调用返回空体或 `"}}` 垃圾体（渠道半残），14/68 窗口不可解析。
- 基础设施事件：LiteLLM fd 泄漏（`Too many open files`）导致 279 次 fetch failed，重启容器恢复；网关每日 06:01 sync 亦有 1–2 分钟全通道中断。两者均已写入报告，建议 infra 会话跟进 fd 泄漏。

### 最终验证（全部真实链路）

| 指标 | yt-en 59min | xyz-zh 70min | fresh-en 15min（全新提交） |
| --- | --- | --- | --- |
| 提交 → 可读 | 3.25 min | 1.25 min | **1.4 min** |
| 提交 → 导读完成 | —（重抽取历史，见下） | —（同左） | **6.4 min** |
| 窗口阶段 | ~6 min | ~10 min | ~2 min |
| 覆盖率 | 100%（308 TU） | 116/117 = 99.1%（407 TU，partial-accepted + retry 生效） | 100%（37 TU，0 失败） |
| embedding（关键路径外） | 371 s | 539 s | 38 s |
| 翻译 | 196/226 turns | —（中文集无需） | 31/46 |
| 投影 | 308 点 | 715 点（同 corpus 累计） | 752 点 |

北极星"贴链接 10 分钟内可读"达标且有余量；**导读层在最终路由下也进入 10 分钟线**（15 分钟单集 6.4 min；59/70 分钟单集窗口阶段 6–10 min + 翻译）。`ops-latency.ts` 今日行：fresh-en submit→readable 1.4m、readable→导读 5.0m。yt-en/xyz 的 p50_to_analyzed 因六次重试历史被拉长（8.2h），不代表最终配置。

工程门禁维持：lint 0、tsc 仅 3 条既有 `@/proxy` 测试错误、相关单测 161 通过（新增 salvage/重试/半截元素丢弃/空 content 用例与 mock 更新）。两次发布均经 `deploy-thinkpad.sh`（82–95 s 构建，门禁通过）。

### 遗留 UNKNOWN（下一轮）

- `deepseek-v4.1-flash-fast` 的抽取质量与 `auto` 旗舰档的差异未做人工对比（TU 数量 308/407 vs 旧 run 无成功基线可比）。
- LiteLLM fd 泄漏根因与每日 06:01 sync 中断窗口对批量任务的影响（建议错峰或 infra 侧放宽 request_timeout）。
- 翻译仍内联在 `completed` 之前（本次已在快通道，15 分钟单集全链 6.4 min 可接受；更长单集可再后置）。
- 说话人归属质量需人工读后评估（fresh-en 为单人讲述，46/46 全归属）。


## 公网暴露：nanosparks.udify.fun 已打通（2026-10-19 晚）

### 接入链路

- DNS：域名原有记录指向 Mac 旧 tunnel `7cb14fc8`（其 ingress 指向已死的 Mac 本地 7557 → 502）。从 Mac 用账户证书执行 `cloudflared tunnel route dns --overwrite-dns b3587e4b… nanosparks.udify.fun` 改指 ThinkPad 现役 tunnel（先例：salon9）。
- ThinkPad ingress（`~/.config/argus/cloudflared/ingress.yml`，备份 `.bak-nanosparks-20261019`）：`nanosparks.udify.fun → http://127.0.0.1:17503`。

### 途中排掉的坑（Clerk × Next 16 × 反代）

公网 https 一进来全部页面/端点 500（EPROTO）。插桩实锤根因链：Next standalone 在有 `x-forwarded-proto: https` 时把 middleware 的 `req.url` 拼成 `https://localhost:17503`；Clerk `decorateRequest` 把 `NextResponse.next()` 装饰成**绝对 URL 同址 rewrite**；Next 16 对绝对 rewrite 一律**反代**——https 打进本机 http 端口 → TLS 错误 500。

修复（`src/middleware.ts` `internalizeSameOriginRewrite`，已上线）：同源绝对 rewrite 改写为指向本机的绝对 http URL（`http://127.0.0.1:$PORT<path>`）。两个失败变体记录在案：路径形式 rewrite 让 Next Edge 适配器 `ERR_INVALID_URL` 崩掉；直接删 rewrite 头会让响应悬空（门禁挂死）。本机自代理是纯 http 场景一直在走的路径，无新增风险。

### 公网验证（外网实测）

- `/api/health` 200；`/api/health/worker` 200（redisOk:true、9 队列 JSON）；`/sign-in` 200 完整渲染（19.9KB，标题"登录 · NanoSparks"）；`/` 307 → `/sign-in`；受保护 API 401（登录墙完好）。
- **已知共享问题（非本次引入）**：该 tunnel 的公网延迟方差大（同 tunnel 的 eagleye 6–20s、salon9 2/3 超时，nanosparks 同水平），JSON 与 HTML 都会间歇 >20s 或超时；cloudflared 4 条连接健康、无错误日志。属 Cloudflare 边缘→tunnel 链路质量（若要走 mihomo 出口属 infra 决策）。

### 发布门禁的两笔拦截记录

- `client.ts` 空 content 守卫用了未导入的 `logger`（Type check 拦下，线上未受影响）——该补丁后曾只跑 eslint 没跑 tsc，流程教训。
- 侧端口验证前忘了清掉上一次诊断残留的 17504 进程，导致误测旧版本（已清）。
