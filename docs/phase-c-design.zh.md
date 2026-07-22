# Phase C 执行级设计文档 — 内容社交

> 状态：落地中 | 对应 PRD `docs/iteration-plan-2026-08-production.md` §6（Phase C）。
> 原则：C4 设数据闸门，逐层解锁，避免冷启动失败。

## 1. 目的

把单人价值（读）变成回访钩子（关注/digest）与社交沉淀（高亮即评论/主播认领）。公开内容库同时是获客引擎。

## 2. 已落地模块

| 层 | 模块 | 文件 | 说明 |
|----|------|------|------|
| C1 公开库 | 公开页 | `src/app/p/[slug]/page.tsx` | 导读+金句（≤10 短引用+出处回链），全文登录；SEO（h1/schema.org PodcastEpisode/OG） |
| C1 公开库 | slug 生成 | `src/lib/public-slug.ts` | CJK 保留、标点剥离、hash 后缀保证唯一、collision 重试 |
| C1 公开库 | sitemap | `src/app/sitemap.ts` | 列出所有 publicSlug 页，weekly 优先级 |
| C2 高亮 | 高亮 API | `src/app/api/conversations/[id]/highlights/route.ts` | POST/GET/DELETE，锚定 turn+offset（复用 EvidenceSpan 语义） |
| C3 关注 | 关注 API | `src/app/api/follows/route.ts` | 关注 source/topic，幂等 upsert；digest worker 消费 Follow 表 |
| C4 闸门 | 闸门评估 | `src/lib/community/gate.ts` | 周 UV>1k 或周高亮用户>100 解锁；纯谓词 gateUnlockedFromCounts |

## 3. 合规分层（PRD §8 + ADR #5）

公开页只放导读 + 短引用（≤10）+ 出处回链；全文登录可见。上传文件永不入共享缓存。主播认领（C4）把版权对手变生态盟友。

## 4. 数据闸门（PRD §C4）

- `gateUnlockedFromCounts(uv, highlighters)` 纯谓词，UI feature-flag 无需 DB。
- `evaluateCommunityGate()` 读 GlobalEpisode + Highlight 周窗口。
- 阈值可经 env 调（`COMMUNITY_GATE_WEEKLY_UV` / `COMMUNITY_GATE_WEEKLY_HIGHLIGHT_USERS`）。

## 5. 退出标准（PRD §C1-C4）

- [ ] 公开页 SEO 收录（h1/schema.org/OG/sitemap）
- [ ] 高亮→一键金句卡（复用 B1）闭环
- [ ] 关注节目后新集自动转写入缓存
- [ ] 主播认领流程（官方标识/全文公开权/shownotes 工具）
- [ ] C4 数据闸门在阈值达成前保持关闭

## 6. 诚实标注

- 周指标用 GlobalEpisode 被读数作 UV 代理（真实 UV 需事件表），已在代码注释说明。
- digest worker（RSS 轮询→自动转写入缓存）作为独立队列任务，骨架在 Follow API 已留接口。

*文档版本: 1.0 | 日期: 2026-07-22*
