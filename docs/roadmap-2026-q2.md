# NanoSparks 研发计划 — 2026 Q2

> 目标：从「技术验证原型」到「可内测的 SaaS 产品」
> 当前基线：TypeScript 零错误，29 测试通过，5 项 CRITICAL 修复完成，架构重构完成

---

## 一、里程碑总览

```
M1 ──► M2 ──► M3 ──► M4 ──► M5
 │      │      │      │      │
安全   核心   体验   质量   发布
加固   闭环   打磨   冲刺   上线
0-2w   2-4w   4-6w   6-8w   8-10w
```

---

## 二、M1：安全加固与基础设施（0-2 周）

### 2.1 安全与合规

| 任务 | 优先级 | 预估 | 技术方案 |
|------|--------|------|---------|
| Prisma JSON 字段运行时类型收窄 | P0 | 2d | Zod 验证后生成 Prisma `Json` 类型的 typed helper，替代 `as unknown as never` |
| Rate limit 迁移到 Redis | P0 | 1d | 用 `ioredis` 的 `INCR` + `EXPIRE` 替代内存 Map |
| Worker 健康检查端点 | P1 | 1d | BullMQ `Queue.getJobCounts()` 暴露 `/api/health/worker` |
| Prompt 注入防护 | P1 | 2d | transcript 长度截断（<16k token），敏感字符过滤 |
| 依赖安全审计 | P2 | 1d | `npm audit` 集成 CI，扫描已知 CVE |

### 2.2 测试补齐（目标：覆盖率 60%+）

| 测试文件 | 覆盖模块 | 优先级 | 预估 |
|---------|---------|--------|------|
| `youtube/client.test.ts` | YouTube API 客户端 | P0 | 1d |
| `youtube/downloader.test.ts` | yt-dlp 调用 + ID 验证 | P0 | 1d |
| `transcription/whisper.test.ts` | execFile 调用 + fallback | P0 | 1d |
| `queue/worker-factory.test.ts` | BullMQ worker 创建 | P1 | 1d |
| `api/ingest.test.ts` | POST /api/ingest（Prisma mock） | P1 | 1d |

### 2.3 基础设施

- [ ] CI 流水线（GitHub Actions）：type-check + test + build
- [ ] Prisma 迁移脚本生产化（`prisma migrate deploy` 在容器启动时执行）
- [ ] 日志结构化：所有 `logger.*` 输出 JSON，接入 Loki / Datadog-ready

---

## 三、M2：核心链路闭环（2-4 周）

### 3.1 Speaker Diarization（说话人分离）

当前所有 `speakerId` 为空，说话人时间线无法展示。

**方案选型：**

| 方案 | 准确度 | 速度 | 依赖 | 推荐度 |
|------|--------|------|------|--------|
| WhisperX + pyannote | 高 | 慢 | pyannote模型(~400MB) | ★★★ |
| 纯 Whisper 说话人标签 | 中 | 快 | 无需额外模型 | ★★☆ |
| LLM 后处理推断 | 低 | 最快 | 仅API调用 | ★☆☆ |

**实施计划：**
1. 扩展 `scripts/whisper_transcribe.py` 支持 `--diarize` 标志
2. 输出格式增加 `speakerId` 字段
3. Prisma `TranscriptSegment.speakerId` 已存在，直接消费
4. `SpeakerTimeline` 组件已就绪，数据到位即渲染

### 3.2 错误处理与重试策略

| 场景 | 当前行为 | 目标行为 |
|------|---------|---------|
| YouTube API 限流 | 直接失败 | 指数退避 3次 |
| Whisper 模型下载失败 | 静默 fallback | 显式降级 + 通知用户 |
| LLM API 超时 | 整体分析失败 | 部分结果保存 + 标记 `qualityScore` 降低 |
| Prisma 连接丢失 | worker 崩溃 | 连接池重连 + 作业重入队列 |

### 3.3 进度可视化

用户当前只看到 `PENDING / TRANSCRIBING / COMPLETED` 静态标签。需要：

- [ ] SSE 或轮询 `/api/episodes/[id]/status` 实时更新
- [ ] 进度条组件（基于队列位置 + 预估时长）
- [ ] 失败时显示具体错误（"YouTube 视频不可用" vs "转录服务繁忙"）

---

## 四、M3：体验打磨（4-6 周）

### 4.1 Dashboard 完工

`app/dashboard/page.tsx` 当前为占位页面。目标：

- 频道列表（已订阅/已分析）
- 视频卡片网格（状态标签 + 缩略图）
- 分析完成通知（Web Push / 邮件）
- 快速操作：重新分析、删除、分享

### 4.2 交互式可视化增强

| 功能 | 当前状态 | 目标 |
|------|---------|------|
| 论点过滤 | 无 | 按说话人/类型/话题筛选 |
| 图谱缩放 | 基础 Cytoscape | 预设布局（力导向/层次/环形） |
| 时间线跳转 | 静态 D3 | 点击时间点跳转到原视频对应秒数 |
| 引用验证 | AI 生成 | 显示 Wikipedia / 论文 DOI 验证状态 |

### 4.3 Playlist 功能上线

- `/playlists/new` 页面已有，但无后端 API
- 需要：收藏视频 → 创建播放列表 → 生成跨视频主题分析
- 扩展 `analyze.ts` 支持多视频聚合分析（新 prompt + 合并 arguments）

---

## 五、M4：质量冲刺（6-8 周）

### 5.1 LLM 质量优化

| 问题 | 根因 | 方案 |
|------|------|------|
| 论点粒度不一致 | prompt 未定义 chunk 边界 | 按时间窗口分段 + per-chunk 提取 |
| 引用 URL 404 | LLM 幻觉链接 | 添加 URL 可达性检查（HEAD 请求） |
| 话题重叠 | 无聚类后处理 | LDA / HDBSCAN 聚类合并相似话题 |
| qualityScore 不准确 | 简单计数加权 | 引入人工标注数据集训练评分模型 |

### 5.2 RAG 增强引用

`lib/rag/reference-search.ts` 已有 Wikipedia 搜索但未接入。

**完整链路：**
```
LLM 生成引用 ──► URL 可达性检查 ──► Wikipedia 补充搜索 ──► 去重排序 ──► 存储
```

### 5.3 性能基准

- [ ] 单视频端到端耗时基准（<5min 目标）
- [ ] LLM 调用并行优化：5次 → 3次（合并 speaker + topic 提取）
- [ ] 前端首屏渲染 < 2s（SSR + `React.Suspense`）

---

## 六、M5：发布上线（8-10 周）

### 6.1 发布检查清单

- [ ] E2E 覆盖核心链路（Playwright）：提交 URL → 等待完成 → 查看可视化
- [ ] 负载测试：并发 10 个视频 ingest
- [ ]  secrets 审计：无硬编码 key，所有 env var 验证
- [ ] 数据备份策略：PostgreSQL 定时 dump 到 S3
- [ ] 监控告警：worker 死亡、队列堆积、API error rate > 5%

### 6.2 付费模式准备

| 层级 | 限制 | 实现 |
|------|------|------|
| Free | 3 视频/月，单视频 <30min | rate-limit + duration 检查 |
| Pro | 无限，长视频支持 | Stripe 订阅 + Clerk org metadata |
| Team | 协作 playlist + 共享分析 | 扩展 Playlist.userId → orgId |

---

## 七、技术决策记录

### 7.1 已完成决策

| 日期 | 决策 | 上下文 | 替代方案 |
|------|------|--------|---------|
| 2026-04 | BullMQ 队列替代自建 | 可靠、有监控、Redis 已有 | Bull（旧版）、BullMQ 胜出 |
| 2026-04 | Worker 统一工厂模式 | 消除重复代码 | 保留3个独立文件 |
| 2026-04 | LLM 基类抽象 | Claude/OpenAI 共享缓存/重试 | 保持重复代码 |
| 2026-04 | `TRANSCRIBED` 中间态 | 区分转录完成 vs 分析完成 | 直接 COMPLETED（已弃用） |

### 7.2 待决策

| 议题 | 选项A | 选项B | 截止时间 |
|------|-------|-------|---------|
| Speaker diarization | WhisperX（准确，重） | 纯 Whisper（轻，弱） | M2 开始 |
| 前端状态管理 | SWR（轻量） | Zustand（灵活） | M3 开始 |
| 支付集成 | Stripe（标准） | LemonSqueezy（简单） | M5 开始 |
| 部署平台 | Vercel（前端快） | Railway（全栈） | M5 开始 |

---

## 八、风险矩阵

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| WhisperX 集成复杂度超预期 | 中 | 高 | 先用纯 Whisper 标签，渐进增强 |
| YouTube API 配额耗尽 | 高 | 中 | 缓存 channel 元数据，批量请求优化 |
| LLM API 成本暴涨 | 中 | 高 | 5→3 次调用合并，缓存命中率监控 |
| 并发 worker 导致 GPU OOM | 低 | 高 | 单机单 worker，concurrency=1 |
| 竞品（NotebookLM）功能重叠 | 中 | 中 | 差异化：交互图谱 + 多视频对比 |

---

## 九、每周节奏

```
周一   │ 站会 + 本周目标对齐
周二-四 │ 开发 + code review（互相）
周五   │ 测试运行 + demo + retro
周末   │ CI 绿灯检查 + 下周计划微调
```

### 当前周（Week 1）行动项

1. [ ] 设置 GitHub Actions CI（type-check + vitest）
2. [ ] 完成 `youtube/client.test.ts` 和 `transcription/whisper.test.ts`
3. [ ] 评估 WhisperX vs pyannote 的 Docker 集成难度
4. [ ] 设计 `/api/episodes/[id]/stream` SSE 端点（进度推送）

---

*计划版本: v1.0 | 作者: Claude | 日期: 2026-04-24*
*更新频率: 每 milestone 结束后回顾更新*
