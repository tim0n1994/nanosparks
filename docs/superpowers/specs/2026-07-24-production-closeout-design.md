# 生产收口设计 (Production Closeout)

> 日期: 2026-07-24
> 状态: 已批准 (用户 `/goal 批准这个设计然后全部实施落地`)
> 上游审计: 2026-07-23 三路并行审计（build/test、secrets/deploy、infra/data）

## 1. 目标

把项目从「只能本机跑的 dev 原型」推进到「可一键上云的安全生产态」。
本设计只做工程收口，**不含**外部运营依赖（ICP 备案、企业主体、律师审核、平台认证号发布）——这些属并行运营轨。

## 2. 现状（证据化）

已就绪（代码层面）：PRD v4 三阶段功能全部落地；`tsc --noEmit` 零错误；`eslint` 0 error；DB schema 与 11 个迁移对齐无漂移；本地 Postgres/Redis/MinIO 链路通；端到端跑通过 1 条真实播客。

5 个硬阻断（今天无法上线）：
1. `npm run build` 失败 —— `@resvg/resvg-js` 原生模块无法被 Turbopack 打包；Docker/CI build 全红。
2. 应用零鉴权 —— Clerk key 为占位符使 `isValidClerkKey=false`，跳过鉴权；无 `middleware.ts`；~31 个 API（含 admin/takedown、invite-codes）裸露。
3. 无生产基础设施 —— 所有连接指向 localhost/127.0.0.1；无生产 Postgres/Redis/S3；无任何部署目标 IaC。
4. ASR 生产路径矛盾 —— factory 默认选本地 `mlx-qwen3-asr`（仅 Apple Silicon），部署目标是 Linux VPS；`BAILIAN_API_KEY` 未配。
5. 无 git remote —— CI 从未运行、无远程备份。

显著缺口：测试 614/617（2 个 e2e 失败，"617 全过"口径不实）；`ENCRYPTION_MASTER_KEY` 缺失；worker 无生产守护；`.env.example` 仅 16 项而代码读 58 项；备份脚本未接 cron；零可观测性；历史 6031 turn participantId 全 null。

## 3. 设计（5 个单元，按依赖与风险排序）

### 单元 1 · 生产构建通过（硬阻断）
- `next.config.ts` 的 `serverExternalPackages` 加入 `@resvg/resvg-js`（及 satori 相关原生依赖），使其不被 Turbopack bundle。
- 验证 `npm run build` 通过；Docker/CI build 转绿。
- 统一端口约定：dev=7557 / start=2333 / docker=3000，在文档中明确说明（不改默认值，只消除歧义）。
- 验收：`npm run build` exit 0，`.next/standalone` 产物存在。

### 单元 2 · 鉴权硬化（硬阻断，安全最高优先级）
- 新增 `src/middleware.ts`，用 `clerkMiddleware` 做路由级拦截；白名单公开路径（`/p/`、`/api/health`、Clerk 自身路由、静态资源）。
- 所有 admin/写路由（`admin/takedown`、`admin/invite-codes`、`*/reprocess`、`*/reextract`、`*/export`、`sources/*`、`corpora/*` 写操作）强制 `auth()` + 邀请码/admin 校验。
- `isValidClerkKey=false` 且 `NODE_ENV=production` 时**拒绝启动**（fail-fast），杜绝静默开放。
- `.env.example` 标注 Clerk key 必填。
- 验收：未登录访问 admin 路由返回 401；中间件覆盖所有写路由；生产模式无 key 时启动报错。

### 单元 3 · ASR 生产路径归位（硬阻断）
- `src/lib/transcription/factory.ts`：默认优先级改为 **百炼(中文) + Deepgram(英文) 优先**；`mlx-qwen3-asr` 仅在 `NODE_ENV!==production` 或显式 `ASR_PROVIDER_OVERRIDE=qwen` 时使用。
- `BAILIAN_API_KEY` 文档化与 `.env.example` 补齐。
- 单测覆盖 factory 路由：production + 无本地 ASR → 走云 ASR。
- 验收：factory 在 `NODE_ENV=production` 且无 QWEN_ASR_URL 时不再选 mlx；单测通过。

### 单元 4 · 部署与密钥收口（硬阻断 + 缺口）
- 全量盘点代码 `process.env.*`，重写 `.env.example`：分组 + 必填/可选标注，与代码读的 58 项一致。
- 生成/校验 `ENCRYPTION_MASTER_KEY`；缺失时生产 fail-fast。
- `docker-compose.yml`：app/worker 加 `restart: unless-stopped`。
- 新增 `npm run worker` 脚本（`tsx src/lib/queue/worker.ts`）。
- `scripts/backup-postgres.sh` 接 cron 文档 + 异地存储说明。
- 废弃过时 `docs/deploy.md`（标注 DEPRECATED 或删除）。
- 建 git remote（GitHub 私库）→ push → CI 首次真跑。
- 验收：`.env.example` 与代码读取项一致；生产无加密 key 时 fail-fast；worker 可 `npm run worker` 启动；远程仓库存在且 CI 运行。

### 单元 5 · 质量与可观测（缺口）
- 修 2 个失败 e2e（`src/__tests__/pipeline/e2e.test.ts` 音频文件 mock）。
- logger 升级为结构化输出（精简 JSON 行），加 `SENTRY_DSN` 错误监控接入点（可选配置）。
- dev embedding 404：CCR 不提供 embeddings 接口 → 在 settings/doc 说明降级路径。
- 历史数据：写一次性脚本 `scripts/backfill-turn-speakers.ts`，对已有 turn 重跑 speaker attribution（单元 3 之后）。
- 验收：`vitest run` 全绿；结构化日志输出；backfill 脚本存在且可执行。

## 4. 不做（YAGNI / 运营轨）

- ICP 备案、企业主体、律师审核、认证号发布（纯运营，2–4 周，与代码并行）。
- 全托管采购（RDS/Elasticache）——等部署目标定了再做。本设计只保证「代码可上云」，不替你买机器。
- 主播认领 UI（schema 已留接口，非上线阻断）。

## 5. 总验收标准

- `npm run build` 绿。
- `npx vitest run` 全绿。
- 无 localhost-only 配置残留在生产路径。
- admin 路由未登录返回 401。
- factory 在生产 + 无本地 ASR 时走云 ASR。
- `.env.example` 与代码读的 env 完全一致。
- git remote 存在，CI 运行。

## 6. 风险与回滚

- 每单元独立提交，可单独 revert。
- 单元 1（构建）是其余单元的前置，先做。
- 单元 2（鉴权）改动面最大，需充分回归测试覆盖。
- 单元 3 改 factory 默认优先级，可能影响现有 dev 体验 → 保留 dev 自动选 mlx 的回退。
