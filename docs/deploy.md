> ⚠️ **DEPRECATED (2026-07-24):** This guide is outdated (references Docker
> Compose localhost stack, NEXTAUTH_SECRET, and auto-downloading Whisper — none
> of which match the current production plan). Use
> **[`docs/deploy-phase-a.zh.md`](./deploy-phase-a.zh.md)** instead.

# NanoSparks 部署指南

## 环境要求
- Docker & Docker Compose
- YouTube Data API Key
- OpenAI API Key (用于 LLM 分析)

## 快速启动

```bash
# 1. 复制环境变量
cp .env.example .env
# 编辑 .env 填入你的 API keys

# 2. 启动服务
docker-compose up -d

# 3. 执行数据库迁移
docker-compose exec app npx prisma migrate deploy

# 4. 访问 http://localhost:2333
```

## 本地开发

```bash
npm install
npx prisma migrate dev
npm run dev
```

## Whisper 模型
首次启动时会自动下载 Whisper `base` 模型 (~150MB)。模型缓存在 Docker volume `whisper_models` 中。

如需更换模型，修改 `WHISPER_MODEL_SIZE` 环境变量：
- `tiny` - 39MB, 最快
- `base` - 74MB, 推荐
- `small` - 244MB
- `medium` - 769MB
- `large` - 1550MB, 最准确

## 生产部署注意事项
1. 使用外部 PostgreSQL / Redis 服务时更新 `DATABASE_URL` 和 `REDIS_URL`
2. 配置反向代理 (nginx / Caddy)
3. 设置 `NEXTAUTH_SECRET` 和 `NEXTAUTH_URL` (如启用认证)
4. 监控 worker 日志: `docker-compose logs -f worker`
