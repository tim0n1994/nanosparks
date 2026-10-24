#!/usr/bin/env bash
# =============================================================================
# deploy/thinkpad/deploy.sh — NanoSparks ThinkPad 生产发布 CD 合同
# =============================================================================
# 用法
#   deploy/thinkpad/deploy.sh             真实发布（幂等、可重入）
#   deploy/thinkpad/deploy.sh --dry-run   只打印计划并 exit 0，零副作用
#   deploy/thinkpad/deploy.sh --help      本说明
#
# 五阶段（真实运行顺序）
#   ① backup   备份当前部署单元 .next → $NSP_BACKUPS_DIR/next-<stamp>-<sha>/
#              （保留最近 NSP_KEEP_BACKUPS=2 份，超出清理）
#   ② migrate  npx prisma migrate deploy。prisma.config.ts 只 loadEnv(.env)，
#              而 DATABASE_URL 只存在于 .env.private-host.invalid（systemd 单元的
#              EnvironmentFile），故本阶段从该文件单独提取并仅注入该键，
#              绝不回显。dry-run 跳过执行。
#   ③ release  隔离构建 → 原子替换 .next → 重启 app/worker。
#              逻辑内联自 scripts/deploy-thinkpad.sh（成熟路径，逐句保留语义），
#              构建加 nice -n 19。
#   ④ gate     gate_http_ready：/api/health → HTTP 200；
#              /api/health/worker → body 含 "redisOk":true（成功路径 200；
#              Redis 不可达时 503 + redisOk:false，见
#              src/app/api/health/worker/route.ts）；worker unit active。
#              超时 → 自动回滚 .next 并 fail。
#   ⑤ verify   在隔离 RELEASE_DIR 内以 nice -n 19 顺序执行项目 verify 六阶段
#              （db:generate → type-check → lint → test --run → build →
#              verify:design，与 package.json "verify" 一致），任一非 0 即 fail。
#              在隔离目录跑是因为 verify 含 next build，而 next build 开跑即清空
#              .next，线上进程正从 .next/standalone 提供服务（原地构建 = 中途 404，
#              见 scripts/deploy-thinkpad.sh 头注）。
#
# 锁语义（重活红线）
#   ①–④ 在 flock -w $NSP_LOCK_WAIT $NSP_LOCK_FILE 下执行；fd 9 只在本脚本
#   最外层获取一次，内联逻辑不调用 flock（scripts/deploy-thinkpad.sh 全文无
#   flock，已核对），不会递归死锁。④ 通过或回滚后即释放，⑤ verify 不持锁
#   （只读隔离目录，避免 30 分钟级 verify 长期霸占 heavy.lock）。
#
# 回滚点（失败路径 exit 非 0 时均保留）
#   - $NSP_BACKUPS_DIR/next-<stamp>-<sha>/   ① 产生，保留最近 2 份
#   - .releases-prev/next                    ③ 切换时由成熟逻辑产生
#   - $RELEASE_DIR                           ③ 隔离构建产物（NSP_RELEASE_DIR=<dir> 可复用）
#   手工回滚：systemctl --user stop nanosparks-app.service nanosparks-worker.service
#             rm -rf .next && cp -a <回滚点> .next
#             systemctl --user start nanosparks-worker.service nanosparks-app.service
#
# 退出码
#    0  成功 / dry-run
#    2  用法或预检失败（未触碰任何状态）
#    3  备份失败（未触碰）
#    4  迁移失败（线上 .next 未触碰；prisma 逐迁移事务，同参重跑安全）
#    5  构建失败（隔离目录中，线上未触碰）
#    6  切换/重启失败（已尝试自动回滚到 .releases-prev/next）
#    7  门禁超时（已自动回滚）
#    8  verify 阶段失败（服务已过门禁保持在线；回滚点保留，由人决定是否回滚）
#    9  heavy.lock 等待超时
#
# 环境变量（均可覆盖，均有默认）
#   NSP_APP_PORT=17503                       应用端口（systemd 单元 PORT）
#   NSP_STATE_ROOT=$HOME/.local/share/nanosparks
#   NSP_RELEASES_ROOT=$NSP_STATE_ROOT/releases
#   NSP_BACKUPS_DIR=$NSP_STATE_ROOT/backups
#   NSP_KEEP_BACKUPS=2
#   NSP_RELEASE_DIR=<绝对路径>               复用已有隔离构建目录（有 standalone 则跳过 rsync/build）
#   NSP_LOCK_FILE=<personal-home>/.local/share/argus/heavy.lock
#   NSP_LOCK_WAIT=1800
#   NSP_GATE_TIMEOUT=300   NSP_GATE_INTERVAL=5
#
# IDEMPOTENCY（同参重跑安全点清单）
#   R0 全流程同参重跑：每次 STAMP 不同 → 新 BACKUP_DEST / 新 RELEASE_DIR，互不冲突；
#      backups/ 轮换按目录名内嵌 STAMP 排序，只删超出 KEEP_BACKUPS 的最旧项。
#   R1 exit 3 后重跑：现场未变，重新备份即安全。
#   R2 exit 4 后重跑：prisma migrate deploy 只应用未应用迁移，已应用者幂等跳过；
#      线上 .next 从未被触碰。
#   R3 exit 5 后重跑：默认全新构建；也可 NSP_RELEASE_DIR=<上次目录> 复用半成品。
#   R4 exit 6/7 后重跑：.next 已自动回滚，重跑从 ① 重新开始（新备份+新构建）。
#   R5 exit 8 后重跑：部署已过门禁在线；重跑是同 commit 的原位重发布，安全。
#   R6 并发互斥：①–④ 持 heavy.lock（最外层一次）；并发实例 flock -w 等待或超时
#      exit 9，不会死锁（无嵌套 flock）。
#   R7 dry-run 严格只读：所有 mkdir/cp/mv/rm/systemctl/curl/npx 均经 run()，
#      dry-run 分支只打印；不加锁、不建目录、不发网络请求。
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

# ---------- 参数 ----------
DRY_RUN=0
usage() {
  printf '用法: deploy/thinkpad/deploy.sh [--dry-run]\n'
  printf '  （无参）    真实发布：备份→迁移→构建切换重启→HTTP 门禁→verify 六阶段\n'
  printf '  --dry-run  只打印计划并 exit 0，零副作用\n'
}
case "${1:-}" in
  "")        ;;
  --dry-run) DRY_RUN=1 ;;
  -h|--help) usage; exit 0 ;;
  *)         usage >&2; printf '✗ 未知参数: %s\n' "$1" >&2; exit 2 ;;
esac
[ "$#" -le 1 ] || { usage >&2; printf '✗ 参数过多\n' >&2; exit 2; }

# ---------- 配置（env 可覆盖） ----------
export PATH="$HOME/.local/bin:$PATH"
APP_PORT="${NSP_APP_PORT:-${PORT:-17503}}"
UNIT_APP="nanosparks-app.service"
UNIT_WORKER="nanosparks-worker.service"
STATE_ROOT="${NSP_STATE_ROOT:-$HOME/.local/share/nanosparks}"
RELEASES_ROOT="${NSP_RELEASES_ROOT:-$STATE_ROOT/releases}"
BACKUPS_DIR="${NSP_BACKUPS_DIR:-$STATE_ROOT/backups}"
KEEP_BACKUPS="${NSP_KEEP_BACKUPS:-2}"
LOCK_FILE="${NSP_LOCK_FILE:-<personal-home>/.local/share/argus/heavy.lock}"
LOCK_WAIT="${NSP_LOCK_WAIT:-1800}"
GATE_TIMEOUT="${NSP_GATE_TIMEOUT:-300}"
GATE_INTERVAL="${NSP_GATE_INTERVAL:-5}"
ENV_FILE_MAIN=".env"
ENV_FILE_HOST=".env.private-host.invalid"
# 六阶段与 package.json "verify" 逐字一致：
# db:generate && type-check && lint && test --run && build && verify:design
VERIFY_PHASES=("db:generate" "type-check" "lint" "test -- --run" "build" "verify:design")

case "$KEEP_BACKUPS" in ''|*[!0-9]*) printf '✗ NSP_KEEP_BACKUPS 须为正整数\n' >&2; exit 2 ;; esac
[ "$KEEP_BACKUPS" -ge 1 ] || { printf '✗ NSP_KEEP_BACKUPS 须 ≥1\n' >&2; exit 2; }

GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo manual)"
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo detached)"
STAMP="$(date +%Y%m%d%H%M%S)"
RELEASE_DIR="${NSP_RELEASE_DIR:-$RELEASES_ROOT/$GIT_SHA-$STAMP}"
BACKUP_DEST="$BACKUPS_DIR/next-$STAMP-$GIT_SHA"   # 名字内嵌 STAMP 在前 → 字典序即时间序

# ---------- 基础助手 ----------
log()  { printf '▸ %s\n' "$*"; }
note() { printf '  %s\n'  "$*"; }

die() {  # die <exit-code> <message...>
  local code="$1"; shift
  printf '✗ %s\n' "$*" >&2
  case "$code" in
    2|3|4|5|9) printf '  线上 .next 未被触碰\n' >&2 ;;
    *) printf '  回滚点: %s（最新一份，共留 %s）/ .releases-prev/next / %s\n' \
        "$BACKUPS_DIR" "$KEEP_BACKUPS" "$RELEASE_DIR" >&2 ;;
  esac
  exit "$code"
}

# 所有有副作用的叶子命令一律经 run()：dry-run 只打印（零副作用的结构性保证），
# 真实模式 eval 执行并透传退出码。调用点自行 `|| die` 定合同退出码。
run() {
  if [ "$DRY_RUN" = 1 ]; then printf '  [plan] %s\n' "$*"; return 0; fi
  eval "$*"
}

# ---------- 锁（最外层唯一一次；fd 9） ----------
LOCK_HELD=0
acquire_lock() {
  log "heavy.lock: flock -w $LOCK_WAIT $LOCK_FILE（fd 9，最外层一次，①–④ 期间持有）"
  if [ "$DRY_RUN" = 1 ]; then
    note '[plan] exec 9>>"'$LOCK_FILE'" && flock -w '"$LOCK_WAIT"' 9   ← dry-run 不加锁'
    return 0
  fi
  if ! ( exec 9>>"$LOCK_FILE" ) 2>/dev/null; then die 9 "无法打开锁文件 $LOCK_FILE"; fi
  exec 9>>"$LOCK_FILE"
  flock -w "$LOCK_WAIT" 9 || die 9 "等待 heavy.lock 超过 ${LOCK_WAIT}s（并发部署或重活占用）"
  LOCK_HELD=1
  note "已持有（pid $$）"
}
release_lock() {
  if [ "$DRY_RUN" = 1 ]; then
    note '[plan] exec 9>&-   ← dry-run 无锁可释'
    return 0
  fi
  [ "$LOCK_HELD" = 1 ] || return 0
  exec 9>&-
  LOCK_HELD=0
  log "已释放 heavy.lock（⑤ verify 不持锁）"
}

# ---------- 预检 ----------
preflight() {
  log "预检（只读）"
  note "仓库 $REPO_ROOT @ $GIT_SHA（$BRANCH）"
  local bad=0 f t
  for f in "$ENV_FILE_MAIN" "$ENV_FILE_HOST" package.json prisma/schema.prisma prisma.config.ts; do
    if [ -f "$f" ]; then note "存在: $f"; else note "缺失: $f"; bad=1; fi
  done
  for t in node npm npx flock rsync curl nice systemctl git; do
    if command -v "$t" >/dev/null 2>&1; then note "工具: $t ok"; else note "缺工具: $t"; bad=1; fi
  done
  run "systemctl --user cat $UNIT_APP $UNIT_WORKER >/dev/null" \
    || { note "systemd 单元缺失或无法读取"; bad=1; }
  if [ "$bad" = 1 ]; then
    if [ "$DRY_RUN" = 1 ]; then note "[warn] 预检未过：真实运行将 exit 2"
    else die 2 "预检失败"; fi
  fi
}

# ---------- ① 备份 ----------
prune_backups() {
  local old
  old="$(ls -1d "$BACKUPS_DIR"/next-* 2>/dev/null | sort -r | tail -n +"$((KEEP_BACKUPS + 1))" || true)"
  if [ -z "$old" ]; then
    note "备份轮换: 现有 ≤ $KEEP_BACKUPS 份，无需清理"
    return 0
  fi
  while IFS= read -r d; do
    if [ -n "$d" ]; then run "rm -rf '$d'"; fi
  done <<<"$old"
}

phase_backup() {
  log "① 备份当前部署单元 .next → $BACKUP_DEST（保留最近 $KEEP_BACKUPS 份）"
  if [ ! -d .next ]; then
    note "[skip] .next 不存在（首次部署），无备份对象，继续"
    return 0
  fi
  run "mkdir -p '$BACKUPS_DIR'" || die 3 "无法创建 $BACKUPS_DIR"
  run "cp -a .next '$BACKUP_DEST'" || die 3 "备份 .next 失败"
  run "printf 'sha=%s stamp=%s src=%s\\n' '$GIT_SHA' '$STAMP' '$REPO_ROOT/.next' > '$BACKUP_DEST/.deploy-backup-info'" \
    || die 3 "写备份元信息失败"
  prune_backups
}

# ---------- ② 迁移 ----------
load_env_value() {  # load_env_value <KEY> <file> —— 提取单个键值，去首尾引号，绝不回显
  local key="$1" file="$2" v
  v="$(grep -E "^${key}=" "$file" | head -n1 | cut -d= -f2-)"
  v="${v%\"}"; v="${v#\"}"; v="${v%\'}"; v="${v#\'}"
  printf '%s' "$v"
}

phase_migrate() {
  log "② 数据库迁移: npx prisma migrate deploy"
  local src=""
  if [ -n "${DATABASE_URL:-}" ]; then src="环境变量"
  elif grep -qE '^DATABASE_URL=' "$ENV_FILE_HOST" 2>/dev/null; then src="$ENV_FILE_HOST"
  elif grep -qE '^DATABASE_URL=' "$ENV_FILE_MAIN" 2>/dev/null; then src="$ENV_FILE_MAIN"
  fi
  if [ -z "$src" ]; then
    if [ "$DRY_RUN" = 1 ]; then
      note "[warn] 未找到 DATABASE_URL（环境/.env/.env.private-host.invalid 均无）：真实运行将 exit 4"
    else
      die 4 "DATABASE_URL 未在环境/$ENV_FILE_HOST/$ENV_FILE_MAIN 中找到"
    fi
  else
    note "DATABASE_URL 来源: $src（值不打印）"
  fi
  if [ "$DRY_RUN" = 1 ]; then
    note '[plan] npx prisma migrate deploy   ← dry-run 跳过执行'
    return 0
  fi
  if [ "$src" != "环境变量" ]; then
    DATABASE_URL="$(load_env_value DATABASE_URL "$src")"
    export DATABASE_URL
  fi
  run "npx prisma migrate deploy" \
    || die 4 "prisma migrate deploy 失败（线上 .next 未触碰；逐迁移事务，修复后同参重跑续传）"
}

# ---------- ③ 构建+原子切换+重启（内联 scripts/deploy-thinkpad.sh 成熟逻辑） ----------
rollback_next() {  # 尽力回滚到 .releases-prev/next（成熟逻辑）
  run "systemctl --user stop $UNIT_APP $UNIT_WORKER || true"
  run "rm -rf .next"
  if [ -d .releases-prev/next ]; then
    run "mv .releases-prev/next .next"
  else
    note "[warn] 无 .releases-prev/next；可从 $BACKUPS_DIR 最新备份手工恢复"
  fi
  run "systemctl --user start $UNIT_WORKER $UNIT_APP || true"
}

switch_next() {  # 每步显式 `|| return 1`：在条件上下文里 set -e 被挂起，靠显式返回防半切换
  run "systemctl --user stop $UNIT_APP $UNIT_WORKER" || return 1
  run "mkdir -p .releases-prev" || return 1
  run "rm -rf .releases-prev/next" || return 1
  if [ -d .next ] || [ "$DRY_RUN" = 1 ]; then
    run "mv .next .releases-prev/next" || return 1
  fi
  run "cp -r '$RELEASE_DIR/.next' .next" || return 1
  run "systemctl --user start $UNIT_WORKER $UNIT_APP" || return 1
  return 0
}

phase_release() {
  log "③ 隔离构建 → 原子替换 .next → 重启 app/worker（内联 scripts/deploy-thinkpad.sh）"
  if [ -d "$RELEASE_DIR/.next/standalone" ]; then
    note "复用已有隔离构建: $RELEASE_DIR（含 standalone，跳过 rsync/build）"
  else
    note "3a prisma generate（主目录；worker 用 tsx 跑源码，需要最新 client）"
    run "npm run db:generate" || die 5 "prisma generate 失败（线上未触碰）"
    note "3b 隔离构建目录 $RELEASE_DIR"
    run "mkdir -p '$RELEASES_ROOT'" || die 5 "无法创建 $RELEASES_ROOT"
    run "rsync -a --delete --exclude node_modules --exclude .next --exclude .git --exclude .releases-prev --exclude '.env*' --exclude '*.log' --exclude .omo ./ '$RELEASE_DIR/'" \
      || die 5 "rsync 隔离目录失败"
    # 硬链接而非软链：Next 的文件追踪会把软链 node_modules 解析到主目录，standalone 结构会错位
    run "cp -al node_modules '$RELEASE_DIR/node_modules'" || die 5 "node_modules 硬链接失败"
    run "cp '$ENV_FILE_MAIN' '$RELEASE_DIR/$ENV_FILE_MAIN'" || die 5 "复制 $ENV_FILE_MAIN 失败"
    run "cp '$ENV_FILE_HOST' '$RELEASE_DIR/$ENV_FILE_HOST'" || die 5 "复制 $ENV_FILE_HOST 失败"
    note "3c next build（standalone，隔离目录，nice -n 19）"
    run "( cd '$RELEASE_DIR' && nice -n 19 npm run build )" \
      || die 5 "构建失败（隔离目录中，线上 .next 未被触碰）"
  fi
  if [ "$DRY_RUN" = 1 ]; then
    note "[check] $RELEASE_DIR/.next/standalone 存在（真实运行此处强校验）"
  elif [ ! -d "$RELEASE_DIR/.next/standalone" ]; then
    die 5 "$RELEASE_DIR 无 standalone 产物"
  fi

  note "3d 当前服务状态"
  run "systemctl --user show -p ActiveState -p MainPID $UNIT_APP $UNIT_WORKER" || true
  note "3e 停止 app/worker → .next 原子替换（上一版移入 .releases-prev/next）→ 启动 worker/app"
  switch_next || {
    log "切换失败，回滚 .next"
    rollback_next
    die 6 "切换/重启失败，已回滚到 .releases-prev/next"
  }
}

# ---------- ④ HTTP 门禁 ----------
probe() {  # 0 = app 200 且 worker 端点 redisOk 且 worker unit active（同成熟 probe）
  local code body
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:${APP_PORT}/api/health" 2>/dev/null || true)"
  [ "$code" = "200" ] || return 1
  body="$(curl -sS --max-time 8 "http://127.0.0.1:${APP_PORT}/api/health/worker" 2>/dev/null || true)"
  grep -q '"redisOk":true' <<<"$body" || return 1
  systemctl --user is-active --quiet "$UNIT_WORKER" || return 1
  return 0
}

gate_http_ready() {
  local waited=0
  while :; do
    probe && return 0
    [ "$waited" -ge "$GATE_TIMEOUT" ] && return 1
    sleep "$GATE_INTERVAL"
    waited=$((waited + GATE_INTERVAL))
    note "等待服务就绪（${waited}s / ${GATE_TIMEOUT}s）"
  done
}

phase_gate() {
  log "④ gate_http_ready: /api/health→200；/api/health/worker→\"redisOk\":true；$UNIT_WORKER active（${GATE_INTERVAL}s 轮询，超时 ${GATE_TIMEOUT}s）"
  if [ "$DRY_RUN" = 1 ]; then
    note "[plan] curl http://127.0.0.1:${APP_PORT}/api/health（期望 200）"
    note "[plan] curl http://127.0.0.1:${APP_PORT}/api/health/worker（期望 body 含 \"redisOk\":true）"
    note "[plan] systemctl --user is-active --quiet $UNIT_WORKER"
    note "[plan] 超时 → rollback_next → exit 7"
    return 0
  fi
  if ! gate_http_ready; then
    log "门禁超时，回滚 .next"
    rollback_next
    die 7 "gate_http_ready 超时（${GATE_TIMEOUT}s），已回滚到上一版 .next"
  fi
  log "门禁通过: /api/health 200、/api/health/worker redisOk、worker active"
}

# ---------- ⑤ verify 六阶段 ----------
phase_verify() {
  log "⑤ 项目 verify 六阶段（隔离目录 $RELEASE_DIR，nice -n 19，任一非 0 即 fail）"
  note "在隔离目录执行: verify 含 next build，会先清空所在目录 .next；线上进程从仓库 .next/standalone 服务，故绝不在主目录跑"
  local i=0 p
  for p in "${VERIFY_PHASES[@]}"; do
    i=$((i + 1))
    note "5.$i/6 npm run $p"
    run "( cd '$RELEASE_DIR' && nice -n 19 npm run $p )" \
      || die 8 "verify 阶段 $i/6（npm run $p）失败；服务已过门禁保持在线，回滚点保留"
  done
  if [ "$DRY_RUN" = 1 ]; then
    note "[plan] 六阶段顺序执行完毕才视为通过；任一非 0 → die 8"
  else
    log "verify 六阶段全部通过"
  fi
}

# ---------- 主流程 ----------
main() {
  if [ "$DRY_RUN" = 1 ]; then
    log "DRY-RUN：只打印计划，零副作用（不加锁、不备份、不迁移、不构建、不切换、不重启、不发网络请求）"
  fi
  log "配置: mode=$([ "$DRY_RUN" = 1 ] && echo dry-run || echo real) sha=$GIT_SHA branch=$BRANCH port=$APP_PORT"
  note "RELEASE_DIR=$RELEASE_DIR"
  note "BACKUPS_DIR=$BACKUPS_DIR（保留 $KEEP_BACKUPS 份）"
  note "LOCK=$LOCK_FILE (wait ${LOCK_WAIT}s)  GATE=${GATE_TIMEOUT}s/${GATE_INTERVAL}s"
  note "verify=${VERIFY_PHASES[*]}"
  preflight
  acquire_lock
  phase_backup
  phase_migrate
  phase_release
  phase_gate
  release_lock
  phase_verify
  log "回滚点: $BACKUPS_DIR（最新一份）/ .releases-prev/next / $RELEASE_DIR"
  if [ "$DRY_RUN" = 1 ]; then
    log "✓ DRY-RUN 完成，exit 0（零副作用）"
  else
    log "✓ 发布完成: $GIT_SHA → http://127.0.0.1:${APP_PORT}"
  fi
}

main "$@"
