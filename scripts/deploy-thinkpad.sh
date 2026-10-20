#!/usr/bin/env bash
# ThinkPad 生产发布：隔离构建 → 原子替换 .next → 重启 app+worker → 健康门禁。
# 取代 macOS 的 deploy-prod.sh（launchd）。任何一步失败立即非零退出并保留上一版。
#
# 用法：bash scripts/deploy-thinkpad.sh [--skip-build]
#   --skip-build  复用 RELEASE_DIR 里上次的构建产物（只做替换+重启+门禁）。
#
# 为什么隔离构建：`next build` 一开始就清空 .next，而线上进程正从
# .next/standalone 提供静态资源；原地构建会让线上页面中途 404，构建失败也无法回退。
set -euo pipefail
cd "$(dirname "$0")/.."

APP_PORT="${PORT:-17503}"
UNIT_APP="nanosparks-app.service"
UNIT_WORKER="nanosparks-worker.service"
RELEASES_ROOT="$HOME/.local/share/nanosparks/releases"
RELEASE_DIR="${RELEASE_DIR:-$RELEASES_ROOT/$(git rev-parse --short HEAD 2>/dev/null || echo manual)-$(date +%Y%m%d%H%M%S)}"
export PATH="$HOME/.local/bin:$PATH"

log() { printf '▸ %s\n' "$*"; }
die() { printf '✗ %s\n' "$*" >&2; exit 1; }

probe() {
  # 0 = app 200 且 worker 健康端点 redisOk 且 worker unit active
  local code body
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:${APP_PORT}/api/health" 2>/dev/null || true)
  [ "$code" = "200" ] || return 1
  body=$(curl -sS --max-time 8 "http://127.0.0.1:${APP_PORT}/api/health/worker" 2>/dev/null || true)
  echo "$body" | grep -q '"redisOk":true' || return 1
  systemctl --user is-active --quiet "$UNIT_WORKER" || return 1
  return 0
}

if [ "${1:-}" != "--skip-build" ]; then
  log "prisma generate（主目录；worker 用 tsx 跑源码，需要最新 client）"
  npm run db:generate >/dev/null

  log "隔离构建目录 ${RELEASE_DIR}"
  mkdir -p "$RELEASES_ROOT"
  rsync -a --delete \
    --exclude node_modules --exclude .next --exclude .git --exclude .releases-prev \
    --exclude '.env*' --exclude '*.log' --exclude .omo \
    ./ "$RELEASE_DIR/"
  # 硬链接而非软链：Next 的文件追踪会把软链 node_modules 解析到主目录，standalone 结构会错位。
  cp -al node_modules "$RELEASE_DIR/node_modules"
  cp .env "$RELEASE_DIR/.env"
  cp .env.private-host.invalid "$RELEASE_DIR/.env.private-host.invalid"

  log "next build（standalone，隔离目录）"
  build_started=$SECONDS
  ( cd "$RELEASE_DIR" && npm run build ) || die "构建失败（线上 .next 未被触碰）"
  log "构建耗时 $((SECONDS - build_started))s"
fi

[ -d "$RELEASE_DIR/.next/standalone" ] || die "$RELEASE_DIR 无 standalone 产物（先去掉 --skip-build）"

log "当前服务状态"
systemctl --user show -p ActiveState -p MainPID "$UNIT_APP" "$UNIT_WORKER" | sed 's/^/  /'

log "停止 app 与 worker，替换 .next"
systemctl --user stop "$UNIT_APP" "$UNIT_WORKER"
mkdir -p .releases-prev
rm -rf .releases-prev/next
[ -d .next ] && mv .next .releases-prev/next
cp -r "$RELEASE_DIR/.next" .next

log "启动 worker 与 app"
systemctl --user start "$UNIT_WORKER" "$UNIT_APP"

ok=""
for i in $(seq 1 24); do
  sleep 5
  if probe; then ok=1; break; fi
  log "等待服务就绪（$((i*5))s）"
done
if [ -z "$ok" ]; then
  log "门禁超时，回滚 .next"
  systemctl --user stop "$UNIT_APP" "$UNIT_WORKER" || true
  rm -rf .next
  [ -d .releases-prev/next ] && mv .releases-prev/next .next
  systemctl --user start "$UNIT_WORKER" "$UNIT_APP" || true
  die "发布失败，已回滚到上一版 .next"
fi

log "门禁通过：/api/health 200、/api/health/worker redisOk、worker active"
log "回滚点：.releases-prev/next；构建产物：$RELEASE_DIR"
log "✓ 发布完成"
