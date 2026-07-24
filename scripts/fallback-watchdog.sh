#!/usr/bin/env bash
#
# fallback-watchdog.sh — NanoSparks 转写链路看门狗
#
# 自动检测并恢复三类"链路中断"故障（基于本次跑通 3.8h 音频踩过的坑）：
#
#   1. ASR 服务卡死/崩溃 → 重启 mlx-qwen3-asr 服务
#   2. 会话卡在 transcribing 假状态（job 失败但 DB 没回写）→ 重置为 pending + 重入队
#   3. 队列残留导致 job 不被消费 → 清理 stalled job + 重入队
#
# 用法:
#   ./scripts/fallback-watchdog.sh            # 单次检查（适合 cron）
#   ./scripts/fallback-watchdog.sh --watch    # 持续监控（每 60s 检查一次）
#
# 需要: docker exec 可用（PSQL/Redis 通过容器）+ tsx（重入队用）

set -euo pipefail

# ── 配置 ──
ASR_URL="${QWEN_ASR_URL:-http://127.0.0.1:4319}"
ASR_KEY="${QWEN_ASR_KEY:-nsp-local}"
ASR_MODEL="${ASR_MODEL:-<personal-home>/models/asr/Qwen3-ASR-0.6B-4bit}"
PG_CONTAINER="${PG_CONTAINER:-nanosparks-postgres-1}"
REDIS_CONTAINER="${REDIS_CONTAINER:-nanosparks-redis-1}"
STUCK_MINUTES="${STUCK_MINUTES:-10}"     # transcribing 超过这么久无进展视为卡死
WATCH_INTERVAL="${WATCH_INTERVAL:-60}"   # --watch 模式的轮询间隔（秒）
LOG_PREFIX="[watchdog]"

log() { echo "$LOG_PREFIX $(date '+%H:%M:%S') $*"; }

# ── ASR 服务管理 ──

asr_health() {
  # 返回 JSON 或空（失败时）
  curl -s -m 5 "${ASR_URL}/health" -H "Authorization: Bearer ${ASR_KEY}" 2>/dev/null || true
}

asr_is_alive() {
  local h; h=$(asr_health)
  [[ "$h" == *"\"status\":\"ok\""* ]]
}

asr_processing() {
  # 返回 processing_jobs 数量（ASR 正在干活时不干预）
  local h; h=$(asr_health)
  echo "$h" | grep -oE '"processing_jobs":[0-9]+' | grep -oE '[0-9]+' || echo 0
}

asr_queued() {
  local h; h=$(asr_health)
  echo "$h" | grep -oE '"queued_jobs":[0-9]+' | grep -oE '[0-9]+' || echo 0
}

asr_restart() {
  log "🔄 重启 mlx-qwen3-asr 服务..."
  local pid; pid=$(pgrep -f "mlx-qwen3-asr serve" | head -1 || true)
  if [ -n "$pid" ]; then
    kill "$pid" 2>/dev/null || true
    sleep 3
    kill -9 "$pid" 2>/dev/null || true
  fi
  sleep 2
  # 用与用户终端一致的方式启动
  nohup "$(echo ~/.venvs/qwen3asr/bin/mlx-qwen3-asr)" serve \
    --model "$ASR_MODEL" \
    --port 4319 --api-key "$ASR_KEY" \
    > /tmp/qwen-asr.log 2>&1 &
  log "ASR 重启中 (PID $!)，等待模型加载..."
  # 等待服务就绪（最多 30s）
  for i in $(seq 1 15); do
    sleep 2
    if asr_is_alive; then log "✅ ASR 服务就绪"; return 0; fi
  done
  log "⚠️ ASR 服务 30s 内未就绪"
  return 1
}

# ── DB / 队列操作 ──

psql_exec() {
  docker exec "$PG_CONTAINER" psql -U nanosparks -d nanosparks -t -A -c "$1" 2>/dev/null
}

redis_exec() {
  docker exec "$REDIS_CONTAINER" redis-cli -n 0 "$@" 2>/dev/null
}

# 找卡死的会话：status=transcribing 且 updatedAt 超过 STUCK_MINUTES
find_stuck_conversations() {
  psql_exec "SELECT id FROM \"Conversation\" WHERE status = 'transcribing' AND \"updatedAt\" < NOW() - INTERVAL '${STUCK_MINUTES} minutes';"
}

# 找会话的音频文件路径（/tmp/nanosparks-audio/{conversationId}.*）
find_audio_path() {
  local cid="$1"
  for ext in m4a mp3 wav webm ogg; do
    local f="/tmp/nanosparks-audio/${cid}.${ext}"
    [ -f "$f" ] && { echo "$f"; return 0; }
  done
  # fallback: 按 platformId 命名
  local pid; pid=$(psql_exec "SELECT \"episodeKey\" FROM \"Conversation\" WHERE id='${cid}';" 2>/dev/null | sed 's/.*://')
  [ -n "$pid" ] && for ext in mp3 m4a wav; do
    local f="/tmp/nanosparks-audio/${pid}.${ext}"
    [ -f "$f" ] && { echo "$f"; return 0; }
  done
  echo ""
}

# 重置会话 + 重入队 transcribe
requeue_conversation() {
  local cid="$1"
  local audio; audio=$(find_audio_path "$cid")
  if [ -z "$audio" ]; then
    log "  ⚠️ $cid: 找不到音频文件，跳过（需重新 ingest）"
    psql_exec "UPDATE \"Conversation\" SET status='pending' WHERE id='${cid}';" >/dev/null
    return
  fi
  log "  📝 $cid: 重置状态 + 重入队 (audio: $(basename "$audio"))"
  psql_exec "UPDATE \"Conversation\" SET status='pending' WHERE id='${cid}';" >/dev/null

  # 用 tsx 入队（带 audioPath 避免 findAudioPath 查 DB 失败）
  cd "$(dirname "$0")/.." || return
  local mime="audio/m4a"
  [[ "$audio" == *.mp3 ]] && mime="audio/mpeg"
  npx tsx -e "
    import { transcribeQueue } from './src/lib/queue/config.ts';
    await transcribeQueue.add('transcribe', {
      conversationId: '${cid}',
      audioPath: '${audio}',
      mimeType: '${mime}',
    });
    process.exit(0);
  " >/dev/null 2>&1 || log "  ⚠️ $cid: 入队失败（worker 可能没在跑）"
}

# ── 主检查逻辑 ──

run_check() {
  log "--- 检查开始 ---"

  # 1. 检查 ASR 服务健康
  if ! asr_is_alive; then
    log "🔴 ASR 服务无响应"
    asr_restart
  else
    local proc que
    proc=$(asr_processing)
    que=$(asr_queued)
    log "✅ ASR 健康 (processing=${proc} queued=${que})"
  fi

  # 2. 检查卡死的会话
  local stuck; stuck=$(find_stuck_conversations)
  if [ -z "$stuck" ]; then
    log "✅ 无卡死会话"
  else
    local count; count=$(echo "$stuck" | wc -l | tr -d ' ')
    log "🔴 发现 ${count} 个卡死会话（transcribing 超过 ${STUCK_MINUTES}min）"

    # 如果 ASR 在处理中（processing_jobs>0），可能是正常的长音频转写
    # 只有 ASR 空闲时才重入队（避免打断正在进行的转写）
    local proc; proc=$(asr_processing)
    if [ "$proc" -gt 0 ]; then
      log "  ℹ️ ASR 正在处理中（processing=${proc}），暂不重入队，等待自然完成"
    else
      while IFS= read -r cid; do
        [ -n "$cid" ] && requeue_conversation "$cid"
      done <<< "$stuck"
    fi
  fi

  # 3. 检查队列 stalled job + worker 僵尸
  #    三种情况:
  #    a) worker 不在跑但有 active job → 清理 + 提示重启 worker
  #    b) worker 在跑但 CPU=0 且 active job 存在 + ASR 空闲 → 僵尸 worker，重启
  #    c) 正常 → 无操作
  local worker_alive; worker_alive=$(pgrep -f "tsx src/lib/queue/worker" | head -1)
  local active_jobs; active_jobs=$(redis_exec llen "bull:transcribe:active" 2>/dev/null || echo 0)
  local asr_proc; asr_proc=$(asr_processing)

  if [ -z "$worker_alive" ] && [ "$active_jobs" -gt 0 ]; then
    log "🔴 worker 不在跑但有 ${active_jobs} 个 active transcribe job（stalled）"
    log "  → 清理 stalled job + 重置卡死会话"
    redis_exec del "bull:transcribe:active" >/dev/null 2>&1 || true
    # 重置可能卡死的会话并重入队
    stuck=$(find_stuck_conversations)
    if [ -n "$stuck" ] && [ "$asr_proc" -eq 0 ]; then
      while IFS= read -r cid; do [ -n "$cid" ] && requeue_conversation "$cid"; done <<< "$stuck"
    fi
  elif [ -n "$worker_alive" ] && [ "$active_jobs" -gt 0 ] && [ "$asr_proc" -eq 0 ]; then
    # worker 在跑 + 有 active job + ASR 空闲 = worker 僵尸（job processor 静默卡死）
    local wcpu; wcpu=$(ps -o %cpu= -p "$worker_alive" 2>/dev/null | tr -d ' ' || echo 0)
    if [ "$(echo "$wcpu < 1" | bc 2>/dev/null || echo 1)" = "1" ]; then
      log "🔴 worker 僵尸 (PID ${worker_alive}, CPU ${wcpu}%, active=${active_jobs}, ASR idle) → 重启"
      kill -9 "$worker_alive" 2>/dev/null || true
      sleep 2
      redis_exec del "bull:transcribe:active" >/dev/null 2>&1 || true
      # 重启 worker（后台）
      cd "$(dirname "$0")/.." || true
      nohup npx tsx src/lib/queue/worker.ts > /tmp/nanosparks-worker.log 2>&1 &
      log "  worker 重启中 (PID $!)"
      sleep 5
      # 重入队卡死的会话
      stuck=$(find_stuck_conversations)
      if [ -n "$stuck" ]; then
        while IFS= read -r cid; do [ -n "$cid" ] && requeue_conversation "$cid"; done <<< "$stuck"
      fi
    else
      log "✅ worker 在跑 (CPU ${wcpu}%, active=${active_jobs})"
    fi
  else
    [ -n "$worker_alive" ] && log "✅ worker 在跑 (active=${active_jobs}, asr=${asr_proc})"
  fi

  log "--- 检查完成 ---"
}

# ── 入口 ──

if [ "${1:-}" = "--watch" ]; then
  log "👁️ 持续监控模式（每 ${WATCH_INTERVAL}s 检查一次，Ctrl+C 退出）"
  while true; do
    run_check
    sleep "$WATCH_INTERVAL"
  done
else
  run_check
fi
