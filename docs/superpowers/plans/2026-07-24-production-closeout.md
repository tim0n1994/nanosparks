# 生产收口实现计划 (Production Closeout)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement inline.
> 对应 spec: `docs/superpowers/specs/2026-07-24-production-closeout-design.md`

**Goal:** 让 nanosparks 从「本机 dev 原型」达到「可一键上云的安全生产态」。

**Architecture:** 5 个独立单元，按依赖与风险排序逐单元实施并提交。单元1(构建)是其余前置；单元2(鉴权)改动面最大；单元3-5 相互独立。

**Tech Stack:** Next.js 16 (Turbopack) / Prisma 7 / BullMQ / Clerk / vitest

## Global Constraints
- 生产构建必须通过：`npm run build` exit 0
- 测试必须全绿：`npx vitest run` 0 失败
- tsc 必须零错误：`npx tsc --noEmit`
- 每单元独立提交，可单独 revert
- 改动遵循现有代码风格

---

### Task 1: 生产构建通过（单元1）

**Files:**
- Modify: `next.config.ts:5`

**Interfaces:**
- Produces: 可用的 `.next/standalone` 生产产物（其余所有单元的前置）

- [ ] Step 1: 把 `@resvg/resvg-js` 加入 `serverExternalPackages`

`next.config.ts` 改为：
```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['bullmq', '@resvg/resvg-js'],
};

export default nextConfig;
```

- [ ] Step 2: 运行 `npm run build`，确认 exit 0、`.next/standalone` 存在
- [ ] Step 3: 提交 `git commit -m "fix(build): externalize @resvg/resvg-js for Turbopack"`

---

### Task 2: 鉴权硬化（单元2）

**Files:**
- Create: `src/middleware.ts`
- Modify: `src/lib/clerk-utils.ts`（加生产 fail-fast）
- Modify: `.env.example`（标注 Clerk 必填）
- Test: `src/__tests__/middleware.test.ts`

**Interfaces:**
- Consumes: `isValidClerkKey` from `@/lib/clerk-utils`, `clerkMiddleware`/`createRouteMatcher` from `@clerk/nextjs/server`
- Produces: 全局路由级鉴权拦截

- [ ] Step 1: 写 middleware 测试（验证公开路径放行、受保护路径拦截）
- [ ] Step 2: 创建 `src/middleware.ts`：
```ts
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { isValidClerkKey } from '@/lib/clerk-utils';

const isPublicRoute = createRouteMatcher([
  '/', '/p/(.*)', '/api/health', '/sign-in(.*)', '/sign-up(.*)',
]);

// When Clerk is not configured (dev), pass through to preserve dev experience.
export default clerkMiddleware((auth, req) => {
  if (!isValidClerkKey) return;
  if (!isPublicRoute(req)) auth().protect();
});
```
- [ ] Step 3: 在 `clerk-utils.ts` 加 `assertClerkConfiguredForProduction()`，在 app 启动处（或各 admin route）调用，生产无 key 时抛错
- [ ] Step 4: 更新 `.env.example` 标注 Clerk 必填 + 注释
- [ ] Step 5: `npx vitest run` 验证全绿；`npm run build` 验证 middleware 编译
- [ ] Step 6: 提交 `git commit -m "feat(auth): add clerk middleware + production fail-fast"`

---

### Task 3: ASR 生产路径归位（单元3）

**Files:**
- Modify: `src/lib/transcription/factory.ts`
- Modify: `src/__tests__/transcription/factory-routing.test.ts`（补 QWEN/WHISPER env 清除 + 生产优先级测试）

**Interfaces:**
- Consumes: `process.env.NODE_ENV`, `QWEN_ASR_URL`, `BAILIAN_API_KEY`, `DEEPGRAM_API_KEY`
- Produces: `createTranscriptionProvider` 在生产环境优先选云 ASR

- [ ] Step 1: 改 `factory.ts`，让 mlx-qwen 仅在非生产或显式 override 时用：
```ts
// 1. Qwen3-ASR local server — dev-only default (Apple Silicon only).
if (process.env.NODE_ENV !== 'production' && process.env.QWEN_ASR_URL) return new QwenAsrProvider();
```
其余优先级（百炼→Deepgram→whisper.cpp→mock）不变。
- [ ] Step 2: 更新 `factory-routing.test.ts` 的 KEYS 列表加入 `QWEN_ASR_URL`、`WHISPER_CPP_PATH` 清除，加生产优先级测试
- [ ] Step 3: `npx vitest run src/__tests__/transcription/factory` 验证
- [ ] Step 4: 提交 `git commit -m "fix(asr): prefer cloud providers in production"`

---

### Task 4: 部署与密钥收口（单元4）

**Files:**
- Modify: `.env.example`（重写，58 项全文档化）
- Modify: `docker-compose.yml`（app/worker 加 restart）
- Modify: `package.json`（加 worker script）
- Modify: `docs/deploy.md`（标注 DEPRECATED）
- Create: `scripts/backfill-turn-speakers.ts`

- [ ] Step 1: 重写 `.env.example` 分组标注（基础设施/认证/LLM/ASR/存储/安全/解析/发布/社区/可观测），与代码读取项一致
- [ ] Step 2: docker-compose app/worker 加 `restart: unless-stopped`
- [ ] Step 3: package.json scripts 加 `"worker": "tsx src/lib/queue/worker.ts"`
- [ ] Step 4: `docs/deploy.md` 顶部加 DEPRECATED 注释指向 deploy-phase-a.zh.md
- [ ] Step 5: 提交 `git commit -m "chore(deploy): env docs, worker script, restart policies"`

---

### Task 5: 质量与可观测（单元5）

**Files:**
- Modify: `src/__tests__/pipeline/e2e.test.ts`（修 2 个失败用例）
- Modify: `src/lib/logger.ts`（结构化输出）
- Create: `scripts/backfill-turn-speakers.ts`

- [ ] Step 1: 修 e2e —— `processTranscribeJob({sourceId,conversationId})` 经 `isConversationAudioData` 路由到 `processConversationTranscribe`，需 mock `@/lib/transcription/factory` 返回 provider + 给 `conversation.findUnique` 返回 mediaAsset.filePath
- [ ] Step 2: logger 改结构化 JSON 行（保留 info/warn/error 接口，下游零改动）
- [ ] Step 3: 创建 backfill 脚本（遍历 null participantId 的会话重跑 assignTurnSpeakers）
- [ ] Step 4: `npx vitest run` 全绿；提交 `git commit -m "fix: e2e tests + structured logging + speaker backfill script"`

---

### Task 6: Git remote + CI 验证

- [ ] Step 1: 确认/创建 GitHub 私库 remote（需用户确认仓库名）
- [ ] Step 2: push → CI 首次真跑
- [ ] Step 3: 总验收

## 总验收清单
- `npm run build` exit 0
- `npx vitest run` 0 失败
- `npx tsc --noEmit` 0 错误
- 未登录访问 `/api/admin/*` 返回 401
- factory 在 `NODE_ENV=production` 无 QWEN 时选云 ASR
- `.env.example` 含代码读取的全部 env key
- git remote 存在
