# AGENTS.md — nanosparks 项目配置

> 本项目级配置，继承全局 AGENTS.md 设置。（2026-09-03 重写：过时的 gstack 技能目录替换为真实质量门禁。）

## 质量门禁（对应 package.json scripts）

| 命令 | 作用 |
| --- | --- |
| `npm run type-check` | `tsc --noEmit` 类型检查，必须退出 0 |
| `npm run lint` | `eslint .`，必须退出 0 |
| `npm run test` | vitest（默认 watch）；verify 中以 `--run` 单次运行 |
| `npm run build` | `next build`（standalone 输出） |
| `npm run verify:design` | `node scripts/assert-design-system.mjs` 设计系统断言 |
| `npm run verify` | 依次执行 db:generate → type-check → lint → test --run → build → verify:design |

- 交付或提交前完整跑一次 `npm run verify`；跑不完时如实说明卡住的阶段与原因，不得只凭单测绿就宣称通过。
- E2E 另用 `npm run test:e2e`（Playwright）。
- 本地栈：`npm run dev`（:7557）、`npm run worker`（BullMQ worker）、`npm run db:generate / db:migrate / db:studio / db:seed`（Prisma）。

## 浏览

所有网页浏览使用 gstack 的 `/browse` 技能，不使用 `mcp__claude-in-chrome__*` 工具。
