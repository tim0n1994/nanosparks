# NanoSparks 架构回顾与现状报告

> 2026-04-24 | 状态：CRITICAL修复完成，架构重构完成，测试覆盖29项通过

---

## 一、系统定位

**NanoSparks** 是一款将 YouTube 播客/访谈视频转化为**交互式思维地图**的 SaaS 工具。

核心链路：
```
YouTube URL → 视频元数据获取 → 音频下载 → Whisper转录 → LLM分析
              → 论点提取/说话人识别/话题聚类/引语抽取 → 关系式存储
              → Cytoscape可视化 → D3时间线 → 交互式探索
```

---

## 二、技术栈全景

| 层级 | 技术选择 | 说明 |
|------|---------|------|
| 框架 | Next.js 14 App Router | SSR + API Routes + React Components |
| 样式 | Tailwind CSS | 原子化CSS，无自定义CSS文件 |
| 认证 | Clerk | OAuth/SSO，middleware路由保护 |
| 数据库 | PostgreSQL 16 | Prisma ORM 5.x，关系式存储 |
| 缓存/队列 | Redis 7 + BullMQ | 三阶段异步流水线 |
| 转录 | OpenAI Whisper (Python) | 本地运行，Docker volume缓存模型 |
| LLM | Claude 3.5 Sonnet (主) + OpenAI GPT-4o-mini (备) | 提取、分析、引用生成 |
| 可视化 | Cytoscape.js + D3.js | 论点图谱 + 说话人时间线 |
| 容器化 | Docker Compose | 4服务：postgres, redis, app, worker |
| 测试 | Vitest + Playwright | 单元测试 + E2E |

---

## 三、服务架构

```
┌──────────────────┐      ┌──────────────┐      ┌──────────────┐
│   Next.js App    │ ──── │   Redis      │ ──── │  PostgreSQL  │
│  (API + Pages)   │      │  (BullMQ)    │      │   (Prisma)   │
└────────┬─────────┘      └──────┬───────┘      └──────────────┘
         │                         │
         │  addJob()               │  poll jobs
         ▼                         ▼
    Ingest Queue             Worker Process
    Transcribe Queue         (tsx worker.ts)
    Analyze Queue
```

### 3.1 双进程模型

- **Next.js App** (`npm run dev` / `docker app`)
  - 处理 HTTP 请求（页面渲染 + API路由）
  - 将作业推入 BullMQ 队列
  - 状态查询 API
- **Worker** (`tsx src/lib/queue/worker.ts` / `docker worker`)
  - 消费队列中的作业
  - 执行耗时操作：下载、转录、LLM分析
  - 独立进程，不阻塞 Web 请求

### 3.2 三阶段流水线

```
INGEST ──► TRANSCRIBE ──► ANALYZE
  │            │             │
  ▼            ▼             ▼
PENDING   TRANSCRIBING   ANALYZING
  │            │             │
  ▼            ▼             ▼
DOWNLOADING TRANSCRIBED  COMPLETED
  │            │             │
  ▼            ▼             ▼
TRANSCRIBING FAILED       FAILED
```

状态机修复：此前 `TRANSCRIBE` 阶段结束后直接标记 `COMPLETED`，导致用户误以为分析已完成。已修复为 `TRANSCRIBED` 中间态。

---

## 四、数据库架构

### 4.1 实体关系

```
Channel 1 ────* Episode 1 ────1 Analysis 1 ────* ReferenceLink
                        │
                        * PlaylistEpisode * ──── Playlist
```

### 4.2 关键设计决策

- **JSON 字段**：transcript, arguments, speakers, topics, quotes 使用 Prisma `Json` 类型
  - 灵活容纳 LLM 返回的非结构化数据
  - 代价：类型安全需运行时 Zod 验证
- **EpisodeStatus 枚举**：6 状态状态机（修复后为 7 状态含 TRANSCRIBED）
- **Cascading delete**：`Analysis → ReferenceLink` 和 `Episode → Analysis` 级联删除

---

## 五、队列与作业系统

### 5.1 Worker Factory 模式（重构后）

```typescript
// src/lib/queue/worker-factory.ts
createWorker({
  queueName: 'transcribe',
  processor: processTranscribeJob,
  concurrency: 1,
  redis,
});
```

此前为每个队列写一份几乎相同的 `ingest-worker.ts` / `transcribe-worker.ts` / `analyze-worker.ts`。重构后统一工厂，消除 ~60 行重复。

### 5.2 作业处理器

| 处理器 | 耗时 | 并发 | 失败策略 |
|--------|------|------|---------|
| `processIngestJob` | ~1-3s (YouTube API) | 2 | 标记 FAILED |
| `processTranscribeJob` | ~30s-5min (Whisper) | 1 | mock fallback + FAILED |
| `processAnalyzeJob` | ~30-60s (5次LLM调用) | 1 | 标记 FAILED |

---

## 六、LLM 集成架构（重构后）

### 6.1 基类 + 实现模式

```
BaseLLMClient (abstract)
  ├─ cache (Map, TTL 1h)
  ├─ hashMessages()
  ├─ complete() — fetch + cache
  ├─ completeWithRetry() — 指数退避 3次
  └─ extractContent()/extractUsage() — 子类实现

ClaudeClient extends BaseLLMClient
  └─ 解析 Anthropic 响应格式

OpenAIClient extends BaseLLMClient
  └─ 解析 OpenAI 响应格式
```

消除 130+ 行重复代码（缓存、hash、重试逻辑）。

### 6.2 LLM 调用矩阵

| 调用 | 并行度 | 输入 | 输出 Schema |
|------|--------|------|------------|
| 论点提取 | 并行1/4 | transcript | `Argument[]` |
| 说话人识别 | 并行2/4 | transcript | `Speaker[]` |
| 话题提取 | 并行3/4 | transcript | `Topic[]` |
| 引语抽取 | 并行4/4 | transcript | `Quote[]` |
| 引用生成 | 串行 | transcript + arguments | `Reference[]` |

分析完成后计算 qualityScore（0-1），基于各维度覆盖率加权。

---

## 七、安全态势（修复后）

| 攻击面 | 修复前风险 | 修复后状态 |
|--------|-----------|-----------|
| Shell 注入 (whisper) | `exec` 字符串拼接 | `execFile` + 数组参数 + 模型白名单 |
| Shell 注入 (yt-dlp) | `exec` 字符串拼接 | `execFile` + YouTube ID 正则验证 |
| XSS (Reference URL) | 直链渲染 LLM 生成的 `javascript:` URL | `isSafeUrl` 过滤，仅允许 http/https |
| 认证绕过 | `/api/ingest` 公开，无 Clerk | 移除公开白名单，强制认证 + rate-limit |
| FK 违规 | `channelId: 'pending'` 硬编码 | 动态获取视频所属 channel 并 upsert |
| API Key 泄露 | docker-compose 缺 `ANTHROPIC_API_KEY` | 补充环境变量传递 |

---

## 八、测试覆盖现状

| 模块 | 测试文件 | 状态 |
|------|---------|------|
| YouTube URL 解析 | `youtube/parser.test.ts` | ✅ 原有 |
| 转录分块 | `transcription/chunker.test.ts` | ✅ 原有 |
| StatusBadge | `ui/StatusBadge.test.tsx` | ✅ 更新 |
| QuoteCard | `visualization/QuoteCard.test.tsx` | ✅ 原有 |
| LLM Client | `lib/llm/client.test.ts` | ✅ **新增** |
| Rate Limit | `lib/rate-limit.test.ts` | ✅ **新增** |
| ReferencePanel | `visualization/ReferencePanel.test.tsx` | ✅ **新增** |

**29 测试通过，0 失败。**

---

## 九、已知技术债务

### 9.1 高优先级

1. **Prisma JSON 字段类型安全**：`analysis.arguments as unknown as AnalysisResult['arguments']` 在多处使用。理想方案：Prisma 4.16+ 的 `Json` 过滤 + 运行时 Zod 验证后的类型收窄。
2. **Memory Store Rate Limit**：`Map<string, RateLimitEntry>` 是进程内存，重启/多实例时丢失。应迁移到 Redis（共享）。
3. **Worker 进程监控**：BullMQ worker 无健康检查端点，无法判断 worker 是否存活。
4. **Chunker 无重叠测试**：`transcription/chunker.ts` 的重叠逻辑有 bug 风险（未测试）。

### 9.2 中优先级

5. **Speaker Diarization**：TODO 注释显示 speaker 分离未实现，当前 `speakerId` 全为空。
6. **LLM Prompt 注入**：transcript 直接拼接进 prompt，恶意内容可能触发 prompt injection。应添加内容长度限制和输入清洗。
7. **ErrorState 组件未使用**：`src/components/ui/ErrorState.tsx` 导入但 `page.tsx` 直接内联渲染错误状态。
8. **Playlist 功能**：路由存在但 `/submit` 仅支持 channel/video URL。

### 9.3 低优先级

9. **Reference Search (Wikipedia)**：`lib/rag/reference-search.ts` 有接口但无调用链路，待集成到分析流程。
10. **Docker 开发体验**：`dev` 模式未配置 docker-compose 热重载。
11. **Dashboard 页面**：`app/dashboard/page.tsx` 存在但功能不完整。

---

## 十、性能特征

| 操作 | 瓶颈 | 优化方向 |
|------|------|---------|
| Whisper 转录 | CPU/GPU（本地运行） | 模型缓存 volume、可选 GPU 容器 |
| LLM 5次调用 | API 延迟 (~5-15s/次) | 5→3 次（合并 prompt）、缓存命中 |
| 可视化渲染 | 前端 Cytoscape 布局 | 服务端预计算布局、增量渲染 |
| 数据库查询 | Prisma N+1（playlist episodes） | `include` 批量加载 |

---

## 十一、部署拓扑

```
                    ┌─────────────┐
                    │   Nginx     │
                    │  (reverse   │
                    │   proxy)    │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌─────────┐ ┌──────────┐ ┌──────────┐
        │Next.js  │ │  Worker  │ │Prisma    │
        │   App   │ │  Process │ │Migration │
        │(3000)   │ │(queue)   │ │(deploy)  │
        └────┬────┘ └────┬─────┘ └──────────┘
             │           │
             └─────┬─────┘
                   ▼
            ┌────────────┐
            │ PostgreSQL │
            │   + Redis  │
            └────────────┘
```

当前 docker-compose 适合单节点。扩展方向：worker 水平扩展（多个 worker 容器消费同一队列）。

---

## 十二、数据流（端到端）

```
用户输入 YouTube URL
  │
  ▼
POST /api/ingest ──► Clerk 认证 + Rate Limit
  │                    │
  │                    ▼
  │              Zod 验证 (url, mode)
  │                    │
  │                    ▼
  │              YouTube API 获取元数据
  │              Prisma upsert Channel + Episode
  │                    │
  │                    ▼
  │              addIngestJob() ──► BullMQ
  │
  ▼
Worker: processIngestJob
  │
  ▼
Episode.status = 'DOWNLOADING'
  │
  ▼
yt-dlp 下载音频 ──► /tmp/nanosparks-audio/
  │
  ▼
Episode.status = 'TRANSCRIBING'
addTranscribeJob() ──► BullMQ
  │
  ▼
Worker: processTranscribeJob
  │
  ▼
Whisper 转录 ──► transcript JSON
  │
  ▼
Episode.status = 'TRANSCRIBED'
addAnalyzeJob() ──► BullMQ
  │
  ▼
Worker: processAnalyzeJob
  │
  ▼
Episode.status = 'ANALYZING'
  │
  ├──► Claude API: 论点提取 (并行)
  ├──► Claude API: 说话人识别 (并行)
  ├──► Claude API: 话题提取 (并行)
  ├──► Claude API: 引语抽取 (并行)
  │         │
  │         ▼
  └──► Claude API: 引用生成 (串行，依赖论点结果)
  │         │
  │         ▼
  │    Prisma: Analysis + ReferenceLink 创建
  │    Episode.status = 'COMPLETED'
  │
  ▼
用户访问 /visualization/[episodeId]
  │
  ▼
SSR 查询 Prisma ──► Cytoscape 图谱 + D3 时间线
```

---

*文档版本: v1.0 | 最后更新: 2026-04-24*
