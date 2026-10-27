# NanoSparks — 人类思想基础设施

[English](README.md)

[公开稳定版本 v0.1.2](https://github.com/tim0n1994/nanosparks/releases/tag/v0.1.2)

[![CI](https://github.com/tim0n1994/nanosparks/actions/workflows/ci.yml)](https://github.com/tim0n1994/nanosparks/actions/workflows/ci.yml)
[![安全检查](https://github.com/tim0n1994/nanosparks/actions/workflows/security.yml)](https://github.com/tim0n1994/nanosparks/actions/workflows/security.yml)
[![许可证](https://img.shields.io/badge/license-ISC-blue.svg)](LICENSE)

> 把真实对话变成有证据链的思想单元与可复用知识。

NanoSparks 把一次 Conversation 当作人类智能的基本单元：把音频、视频或文本变成带时间戳的证据、类型化思想单元、洞察图谱和可检索、可比较、可复用的上下文。

~~~text
来源 → 带证据的转写 → 思想单元 → 洞察图谱 → 可复用上下文
~~~

当前代码库是 Next.js 16 应用，使用 Prisma/Postgres、Redis/BullMQ，以及用于阅读、搜索、提问和探索人物与思想的图谱和可视化组件。PRD 记录产品方向，实际实现以代码为准。

## 本地运行

~~~bash
cp .env.example .env
npm ci
npx prisma generate
npm run dev
~~~

开发服务使用端口 7557。完整验证需要配置本地 PostgreSQL、Redis、认证和 provider 环境：

~~~bash
npm run verify
~~~

该命令覆盖数据库生成、类型检查、lint、测试、构建和设计系统检查。CI 会为集成检查提供隔离的 PostgreSQL 与 Redis 服务；不要把示例环境变量当作真实凭证。

## 证据边界

NanoSparks 保存带时间戳的对话证据，派生思想单元与洞察图谱，并通过 Next.js 应用发布可复用上下文。转写、分析、图谱收敛和生产运行属于不同验收层；健康检查或一次构建通过都不等于完整的产品 E2E。