# Phase A 部署拓扑与护栏（A4）

> 对应 PRD `docs/iteration-plan-2026-08-production.md` §A4。
> 决策：A 阶段 **HK VPS + Clerk + 邀请制免费**；备案与企业主体**立即并行启动**（B/C 最长前置）。

## 1. 拓扑（A 阶段单机）

```
                ┌───────────────┐
   用户 ───────▶│  Cloudflare   │── HK VPS (1 台 CPU)
                │  (CDN/DNS)    │   ├── Next.js (start, SSR + API)
                └───────────────┘   ├── Worker 进程 (BullMQ)
                                     ├── PostgreSQL
                                     ├── Redis（BullMQ + 限流）
                                     └── MinIO（音频 + 预签名 URL）
                                              │
                                     外部 API：百炼(中文ASR) / Deepgram(英文ASR)
                                              DeepSeek/OpenAI(LLM) / Embedding
```

单机够用的前提：A2 改走百炼一体化 API 后，转写与分离**无需 GPU**；LLM 与 embedding 全部走外部 API。本地只跑编排、存储、检索。

## 2. 必备环境变量

见 `.env.example` 的 A1/A2/A4 段。生产最小集：
- `DATABASE_URL` / `REDIS_URL`
- `BAILIAN_API_KEY`（中文默认 ASR，免 GPU 上线的关键）
- `DEEPGRAM_API_KEY`（英文默认 ASR）
- `OPENAI_API_KEY` + `OPENAI_BASE_URL`（或 DeepSeek 兼容端点）
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY`（A 阶段邀请制登录）
- `S3_*`（MinIO，Paraformer 需要公网 URL → 音频落 MinIO 出预签名 URL）
- `ENCRYPTION_MASTER_KEY`（Setting 加密，必填）
- 护栏：`GUARD_MAX_CONCURRENT/DAILY/DURATION_SEC/COST_BREAKER_CNY`

## 3. 护栏（已实现 `src/lib/guardrails.ts`）

| 限制 | 默认 | 说明 |
|------|------|------|
| 单用户并发处理 | 1 | 同一用户同时只能有 1 个 in-flight 会话 |
| 单用户每日上限 | 5 集 | 控制 LLM/ASR 成本 |
| 音频时长上限 | 4h | 百炼单文件建议 ≤2h，超长走 chunker 切片 |
| 单集成本熔断 | ¥3 | ExtractionRun.costUsd × 7.2 超阈即告警 |

所有护栏均可通过 `Setting`（`guardrail.*` key）运行时调参，无需重新部署。

## 3.1 Postgres 每日备份（PRD §A4）

```bash
# Cron: 0 2 * * * DATABASE_URL=... /path/to/scripts/backup-postgres.sh
# 可选：BACKUP_S3_BUCKET=nanosparks-backups S3_ENDPOINT=http://minio:9000
# 保留：BACKUP_RETENTION_DAYS=7（默认本地 7 天）
```

脚本：`scripts/backup-postgres.sh`（pg_dump + gzip + 可选 S3 上传 + 过期清理）。

## 4. 启动 / 关闭顺序

```bash
# 一次性
npx prisma migrate deploy && npx prisma generate

# 常驻
npm run start                       # Next.js (生产)
npx tsx src/lib/queue/worker.ts     # BullMQ worker（所有队列）

# 关闭：先停 worker（等当前 job 完成），再停 Next，再停 docker compose
```

## 5. 退出标准（PRD §A4）

- [ ] 10 条真实链接全部 10 分钟内出带说话人全文
- [ ] 缓存命中秒开
- [ ] 手机阅读流畅
- [ ] 邀请注册可用
- [ ] 单集成本实测入库（`ExtractionRun.costUsd`）
- [ ] 护栏在压测下触发正确

## 6. 备案 / 主体并行项（B/C 前置，立即启动）

- ICP 备案 2–4 周（个人可备；经营性质后续需企业主体）
- 企业主体注册（微信支付/公众号认证服务号/开放平台均需）
- 这两条不串行等待，A 阶段并行推进。

*文档版本: 1.0 | 日期: 2026-07-22*
