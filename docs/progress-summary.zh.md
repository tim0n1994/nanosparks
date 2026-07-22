# NanoSparks PRD v4 迭代进度总结

> 日期：2026-07-23 | 基线：git 982bb3c（I0–I6） | 当前：git d64c64c
> 测试：617 passed（基线 280 → +337）| tsc clean | lint 0 errors

## 一、产品转向
从"人类思想基础设施"研究工具 → "读播客"消费级产品：贴链接 → 10分钟内出可读（说话人+时间戳）、可信、可再创作的图文内容。

## 二、前端改动
### 首页/提交
- 首页改为 SubmitBox 大输入框（移除营销 hero）
- 多集列表选择 + 缓存命中秒跳阅读器

### 阅读器 /read/[conversationId]（全新）
- Hero + 分阶段进度条（排队→下载→转写→整理说话人→生成导读→可读）
- TL;DR + 金句墙 + 章节导航（sticky scrollIntoView）
- 正文按说话人聚段 + 色条 + 时间戳 chip seek 内嵌播放器
- 双语对照（原文/译文/对照）+ "翻译本集"按需触发
- 划句高亮 + 说话人 inline 改名
- 阅读设置（字号/行距/暗色，localStorage）
- 续读提示 + 导出 MD/Obsidian + 图谱/Ask 入口
- MinIO fallback 播放器

### 发布面板 PublishPanel（全新）
- 一键生成三平台图文包 + 分段复制 + 发布回填 + AI 声明引导

### 公开页 /p/[slug]（全新）
- 导读+金句（≤10短引用+出处回链）+ schema.org PodcastEpisode + OG 图

### 其他
- sitemap.xml + robots.txt

## 三、后端改动
### Resolver 链（全新）
- 8源：小宇宙（限速+重试+UA伪装）/ YouTube（含playlist）/ B站 / Apple / Spotify / RSS / 直链（大小熔断）/ yt-dlp兜底

### 全局转写缓存（全新）
- GlobalEpisode(episodeKey) 命中跳管线秒开 + 上传永不入缓存

### ASR
- QwenAsrProvider：直连 mlx-qwen3-asr 本地服务，multilingual + pyannote 说话人分离 + word-level 时间戳
- Factory：Qwen3-ASR（默认）→ Paraformer → Deepgram → whisper.cpp → mock
- 语种探测 + 音频切片（>2h）+ 跨片对齐 + LLM 纠错 pass + 热词词典 + WER/DER 评估

### 内容包 B1/B2
- 卡片模板（金句/清单/对谈/封面）+ satori/resvg PNG + twemoji + AIGC XMP
- 文案（小红书/公众号/知乎回答版）+ 敏感词 + 公众号API + 一鱼多吃 + PublishPanel

### 社交 C1-C4
- 公开页+slug+sitemap+百度/Google push / 高亮+划句UI+一键金句卡 / Collection / Follow+digest / 社区闸门+评论+主播认领

### 护栏+定价+合规
- 并发/日/时长/成本熔断 / Free vs Pro tier + 队列优先 / 缓存不占额度 / 邀请码 / DMCA / 用户协议 / 通知 / Postgres备份

## 四、数据模型（6 migration）
GlobalEpisode / Notification / PublishPackage / Highlight / Collection / CollectionItem / Follow / ReadingProgress + Source/Conversation/Turn 扩展

## 五、验证
617 tests | tsc clean | lint 0 errors | 0 TODOs | 运行时冒烟通过 | Qwen3-ASR 端到端转写验证通过

## 六、剩余项
真实10链接端到端（需网络） / ICP备案 / 律师审核 / 平台认证号发布验证

*文档版本: 1.0 | 日期: 2026-07-23*
