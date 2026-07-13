# AGENTS.md — Proj 项目配置

> 本项目级配置，继承全局 AGENTS.md 设置，并添加项目特定规则。

## gstack 技能集

**所有网页浏览必须使用 gstack 的 `/browse` 技能，禁止使用 `mcp__claude-in-chrome__*` 工具。**

可用技能列表：

- `/office-hours` — 办公时间讨论
- `/plan-ceo-review` — CEO 评审规划
- `/plan-eng-review` — 工程评审规划
- `/plan-design-review` — 设计评审规划
- `/design-consultation` — 设计咨询
- `/design-shotgun` — 快速设计迭代
- `/design-html` — HTML 设计
- `/review` — 代码审查
- `/ship` — 发布
- `/land-and-deploy` — 部署上线
- `/canary` — 金丝雀发布
- `/benchmark` — 性能基准测试
- `/browse` — 网页浏览（**所有浏览任务的首选**）
- `/connect-chrome` — 连接 Chrome 浏览器
- `/qa` — 质量测试
- `/qa-only` — 仅 QA 测试
- `/design-review` — 设计审查
- `/setup-browser-cookies` — 设置浏览器 Cookie
- `/setup-deploy` — 设置部署
- `/retro` — 复盘回顾
- `/investigate` — 问题调查
- `/document-release` — 发布文档
- `/codex` — 代码库分析
- `/cso` — 首席安全官审查
- `/autoplan` — 自动规划
- `/plan-devex-review` — 开发者体验评审规划
- `/devex-review` — 开发者体验审查
- `/careful` — 谨慎模式
- `/freeze` — 冻结代码
- `/guard` — 守护模式
- `/unfreeze` — 解冻代码
- `/gstack-upgrade` — 升级 gstack
- `/learn` — 学习模式

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. The
skill has multi-step workflows, checklists, and quality gates that produce better
results than an ad-hoc answer. When in doubt, invoke the skill. A false positive is
cheaper than a false negative.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke /office-hours
- Strategy, scope, "think bigger", "what should we build" → invoke /plan-ceo-review
- Architecture, "does this design make sense" → invoke /plan-eng-review
- Design system, brand, "how should this look" → invoke /design-consultation
- Design review of a plan → invoke /plan-design-review
- Developer experience of a plan → invoke /plan-devex-review
- "Review everything", full review pipeline → invoke /autoplan
- Bugs, errors, "why is this broken", "wtf", "this doesn't work" → invoke /investigate
- Test the site, find bugs, "does this work" → invoke /qa (or /qa-only for report only)
- Code review, check the diff, "look at my changes" → invoke /review
- Visual polish, design audit, "this looks off" → invoke /design-review
- Developer experience audit, try onboarding → invoke /devex-review
- Ship, deploy, create a PR, "send it" → invoke /ship
- Merge + deploy + verify → invoke /land-and-deploy
- Configure deployment → invoke /setup-deploy
- Post-deploy monitoring → invoke /canary
- Update docs after shipping → invoke /document-release
- Weekly retro, "how'd we do" → invoke /retro
- Second opinion, codex review → invoke /codex
- Safety mode, careful mode, lock it down → invoke /careful or /guard
- Restrict edits to a directory → invoke /freeze or /unfreeze
- Upgrade gstack → invoke /gstack-upgrade
- Save progress, "save my work" → invoke /context-save
- Resume, restore, "where was I" → invoke /context-restore
- Security audit, OWASP, "is this secure" → invoke /cso
- Make a PDF, document, publication → invoke /make-pdf
- Launch real browser for QA → invoke /open-gstack-browser
- Import cookies for authenticated testing → invoke /setup-browser-cookies
- Performance regression, page speed, benchmarks → invoke /benchmark
- Review what gstack has learned → invoke /learn
- Tune question sensitivity → invoke /plan-tune
- Code quality dashboard → invoke /health
