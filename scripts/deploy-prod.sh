#!/usr/bin/env bash
# 生产部署：build → 补 standalone static/public → 重启 launchd web。
# 改完代码后跑 `bash scripts/deploy-prod.sh` 即可重新上线（worker 无需重启，
# 它跑的是 tsx 源码，下次拉到队列的 job 自动用新代码；如改了 worker 逻辑再
# `launchctl kickstart -k gui/$(id -u)/com.nanosparks.worker`）。
set -euo pipefail
cd "$(dirname "$0")/.."

echo "▸ prisma generate"
npm run db:generate

echo "▸ next build (standalone)"
npm run build

echo "▸ 补 standalone static/public（standalone 产物不含这些）"
rm -rf .next/standalone/.next/static
cp -r .next/static .next/standalone/.next/static
[ -d public ] && { rm -rf .next/standalone/public; cp -r public .next/standalone/public; }

echo "▸ 重启 launchd web"
launchctl kickstart -k "gui/$(id -u)/com.nanosparks.web"
sleep 3

echo "▸ 验证"
curl -sS -o /dev/null -w "  /settings → HTTP %{http_code}\n" --max-time 15 http://localhost:7557/settings \
  || echo "  ⚠ 本地 7557 未就绪，看 ~/Library/Logs/nanosparks/web.err.log"
echo "✓ 部署完成"
