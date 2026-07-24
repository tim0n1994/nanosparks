# 批量处理播客 (Batch Ingest) 实现计划

## 目标
粘贴一个播客源/频道链接 → 系统解析出全部节目 → 用户手动勾选范围（支持全选/范围选）→ 批量入队处理。走正常月度额度（Free 4 / Pro 60），已缓存集免费。LLM 端点由 settings 自动驱动（无需额外配置）。

## 核心设计决策
1. **复用现有解析结果**：用户第一次 POST `/api/ingest` 拿到 `multiEpisode: true` + `episodes[]`，客户端已持有节目列表。批处理接口直接接收**用户选中的 episode 数据**（episodeKey/audioUrl/sourceUrl/platform/title），不再重复 resolve。这是 digest worker 的成熟模式。
2. **额度只走月度配额**：批处理逐集 `findOrLinkGlobalEpisode`，未命中缓存的集消耗月度额度（Free 4/Pro 60）。在批量内**本地递减**剩余额度（避免逐集查到过期计数导致超发）。
3. **并发/日护栏不在入队时拦截**：`checkIngestGuardrails` 的 `maxConcurrentPerUser=1` 是为单集交互提交设计的，逐集检查会让第 2 集被拒。批处理让 worker 的 `transcribe concurrency=1` 天然串行化（你选中的 20 集会排队逐个转写，不会崩溃）。单集成本熔断 ¥3 仍逐集生效（在 analyze 完成时）。
4. **无需新数据模型**：批处理返回 `conversationIds[]`，进度由一个聚合查询接口按 `Conversation.status` 统计，不建 Batch 表（避免 migration）。
5. **去重幂等**：复用 `findOrLinkGlobalEpisode`（按 `episodeKey` 去重），已缓存的集秒读、免费、不计额度。重跑同一播客安全。

## 文件改动

### 新建 `src/lib/queue/batch.ts` — 纯批量编排逻辑（可单测）
导出 `batchIngestEpisodes(args)` 纯函数，参数：
```ts
{
  userId: string;
  episodes: Array<{ episodeKey: string; audioUrl: string; sourceUrl: string; platform: string; title: string; durationSec?: number }>;
  mode: string;
}
```
返回 `{ enqueued: ConversationResult[]; skippedCached: number; skippedQuota: number; quotaUsed: number; quotaLimit: number }`。

逻辑：
1. `getUserTier(userId)` → `monthlyQuotaFor(tier)` 得到额度上限
2. `getMonthlyQuotaStatus(userId)` → 得到已用 `used`，本地剩余 = `limit - used`
3. 逐集：`findOrLinkGlobalEpisode(resolved, userId)` →
   - `cached` → `skippedCached++`，跳过（免费）
   - 未命中且 `本地剩余 <= 0` → `skippedQuota++`，跳过
   - 未命中且有余量 → `addIngestJob(...)`，`本地剩余--`，`quotaUsed++`，收集 conversationId
4. 返回结果（含每集的 conversationId + 是否缓存）

注：resolved 对象从传入的 episode 字段构造（`{ platform, platformId, episodeKey, title, audioUrl, sourceUrl, isMultiEpisode:false }`），与 digest.ts:84-95 构造方式一致。

### 新建 `src/app/api/ingest/batch/route.ts` — 批量入队接口
`POST /api/ingest/batch`，body: `{ url: string (源链接，仅用于日志/归属), episodes: SelectedEpisode[], mode?: 'robot' }`。
- 鉴权（复用 `isValidClerkKey` + `auth()` 模式，与 ingest route 一致）
- 限流（复用 `rateLimit`）
- 调 `batchIngestEpisodes(...)`
- 返回 `{ success, enqueued: [{conversationId, title, cached}], skippedCached, skippedQuota, quotaUsed, quotaLimit }`
- 200 即使部分跳过（在 body 里说明哪些被额度挡了）

### 新建 `src/app/api/conversations/batch-status/route.ts` — 批量进度聚合
`GET /api/conversations/batch-status?ids=id1,id2,id3` →
- 查 `prisma.conversation.findMany({ where: { id: { in: ids } }, select: { id, title, status } })`
- 返回 `{ total, completed, processing, failed, queued, episodes: [{id, title, status, ready}] }`
- 客户端每 3-4 秒轮询，直到 `completed + failed === total`

### 修改 `src/components/reader/SubmitBox.tsx` — 选择 + 批量 UI
现有 `multiEpisode` 块（line 344-356）改为：
- 每集加 checkbox（`Set<string> selectedKeys`）
- 顶部加「全选 / 反选」「批量处理选中 (N)」按钮
- 范围选：shift+点击首尾选中区间（标准多选交互）
- 点「批量处理」→ POST `/api/ingest/batch` → 切换到批量进度视图
- 批量进度视图：展示 `已处理 X / 总 N`、每集状态（完成/处理中/排队/失败/因额度跳过）、完成的集可点击跳 `/read/:id`
- 提示被额度挡住的集数（`skippedQuota`），引导升级 Pro

### 复用（不改）
- `resolveUrl()`（解析器已返回 episodes[]，支持 youtube/apple/xiaoyuzhou/rss）
- `findOrLinkGlobalEpisode`（去重 + 缓存）
- `addIngestJob`（入队）
- `getMonthlyQuotaStatus` / `monthlyQuotaFor` / `getUserTier`（额度）
- 单集 SSE 进度（`/api/conversations/[id]/progress`）——批量视图用聚合接口，不并发开 N 个 SSE
- analyze worker 自动读 settings LLM 端点（无需配置）

## 平台覆盖
- ✅ youtube（频道/播放列表，约 10 集）、apple、小宇宙、RSS 源——解析器已返回 episodes[]
- ⚠️ bilibili/direct/generic——单集模式，不支持批量（yt-dlp 单文件）。若用户粘这类链接，解析返回非 multiEpisode，走原单集流程。UI 不显示批量按钮。

## 额度与护栏行为（你选的「正常额度」）
| 检查 | 批处理路径 | 说明 |
|---|---|---|
| 月度额度 Free 4 / Pro 60 | ✅ 应用 | 本地递减，用完的集跳过并提示 |
| 缓存命中 | 免费、不计额度 | findOrLinkGlobalEpisode 去重 |
| 并发护栏 maxConcurrent=1 | ❌ 入队时不拦 | worker transcribe=1 天然串行 |
| 日护栏 maxDaily=5 | ❌ 入队时不拦 | 同上，避免大播客被日限卡死 |
| 单集成本熔断 ¥3 | ✅ 逐集生效 | analyze 完成时检查 |

## 对正在跑的 ASR 的影响
- 开发本功能：零影响
- 实际跑批处理：选中的集入 ingest 队列，transcribe 步骤排在当前 ASR 任务**后面**逐个处理（transcribe 并发=1）。不会崩溃/冲突，纯排队延迟。

## 验收标准
- 粘贴 RSS/apple/小宇宙/youtube 源链接 → 显示节目列表 + 可勾选 + 全选/范围选
- 选 N 集点批量处理 → 未缓存集入队、已缓存集秒读、超额集跳过并提示
- 批量进度视图实时更新（完成/处理中/排队/失败/额度跳过）
- 完成的集可点击跳阅读器
- 走正常月度额度，重跑同一播客幂等（已缓存集免费）
- tsc 干净、新增纯逻辑 `batch.ts` 有单测

## 测试
- `batchIngestEpisodes` 纯函数单测：全缓存（0 入队）、额度耗尽（部分跳过）、混合（缓存+新集+超额）三种场景，mock prisma + addIngestJob
- 集成：粘真实 RSS 源，验证去重 + 入队 + 进度聚合