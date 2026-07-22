# Phase B 执行级设计文档 — 图文分发

> 状态：落地中 | 对应 PRD `docs/iteration-plan-2026-08-production.md` §5（Phase B）。
> 原则（ADR #3）：我们是"内容包生成器"，不是"自动发布机"。human-in-the-loop。

## 1. 目的

一集播客 → 一次点击 → 三平台产物齐全（公众号长文 ×1 + 小红书笔记 ×2-3 + 知乎 ×1）。让创作者半天完成过去三天的产出。

## 2. 已落地模块

| 模块 | 文件 | 说明 |
|------|------|------|
| 数据模型 | `prisma/schema.prisma` PublishPackage | (conversation, platform, variant) 唯一；status/costUsd/assetsJson |
| 卡片布局 | `src/lib/publish/cards.ts` | 1242×1656（3:4），金句/清单/对谈三模板；字号档位自适应；wrapText 处理 CJK 双宽 |
| 卡片渲染 | `renderCardPng()` | satori(React→SVG)+resvg→PNG，懒加载（缺依赖时抛清晰错误，布局层可独立测试） |
| 文案生成 | `src/lib/publish/copy.ts` | 小红书/公众号/知乎各一 prompt；结构约束 + 出处行固定 + 禁敏感词指令 |
| 敏感词 | `src/lib/publish/sensitive-words.ts` | 医疗/绝对化/引流/违禁 四类词库；scan + applyRewrites + isClean |
| 发布通道 | `src/lib/publish/channels.ts` | 公众号 HTML 白名单 + Clipboard text/html；小红书/知乎 分段复制；AIGC XMP 标识 |
| 一鱼多吃 | `src/lib/publish/package-builder.ts` | DEFAULT_MATRIX(wechat×1+xiaohongshu×3+zhihu×1)；upsert + 成本估算 |
| API | `POST /api/conversations/:id/packages` | 触发生成；GET 读列表 |

## 3. 合规落地（PRD §8 标识办法）

- 显式标识：界面提示"AI 辅助生成"。
- 隐式标识：`buildAigcXmp()` 写 PNG 元数据（providerCode + contentId + isAigc）。
- 平台声明引导：`declarationGuideFor()` 返回各平台主动声明路径。
- 出处规范：每个 prompt 强制出处行 `🎙️来源：《节目》EP.X`。

## 4. 退出标准（PRD §B2）

- [ ] 一集 → 一次点击 → 三平台产物齐全
- [ ] 小红书实发 5 篇验证真机显示与流量
- [ ] 公众号 API 通道在认证号上跑通（draft/add）
- [ ] 敏感词命中在 UI 高亮
- [ ] AIGC 标识写进导出文件元数据

## 5. 依赖与降级

- satori + @resvg/resvg-js：可选依赖，未安装时 `renderCardPng` 抛清晰错误，文案/敏感词/通道层不受影响。
- 中文字体（思源黑体/霞鹜文楷）：OFL 可商用，渲染器 bootstrap 加载。
- LLM：走 model-router（敏感→local，公开→cloud），成本进 PublishPackage.costUsd。

*文档版本: 1.0 | 日期: 2026-07-22*
