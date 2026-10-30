#!/bin/bash
# Start all nanosparks services: postgres+redis (docker) → embedding → worker → web.
# Idempotent: skips services already running.
set -euo pipefail

PLIST_DIR="$HOME/Library/LaunchAgents"
LOG_DIR="$HOME/Library/Logs/nanosparks"
PROJECT_DIR="${NSP_PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
mkdir -p "$LOG_DIR"

# ── 1. Docker: postgres + redis ──
echo "▶ docker: postgres + redis"
cd "$PROJECT_DIR"
docker compose up -d postgres redis 2>/dev/null

# ── 2. Embedding server (llama.cpp + bge-m3) ──
if curl -sf http://127.0.0.1:8080/health >/dev/null 2>&1; then
  echo "✓ embedding: already running"
else
  echo "▶ embedding: loading launchd agent"
  launchctl unload "$PLIST_DIR/com.nanosparks.embedding.plist" 2>/dev/null || true
  launchctl load "$PLIST_DIR/com.nanosparks.embedding.plist"
  # Wait for health (model load takes a few seconds)
  for i in $(seq 1 30); do
    if curl -sf http://127.0.0.1:8080/health >/dev/null 2>&1; then
      echo "✓ embedding: ready"
      break
    fi
    sleep 1
    [ "$i" = "30" ] && echo "⚠ embedding: not responding after 30s (check $LOG_DIR/embedding.err.log)"
  done
fi

# ── 3. Worker ──
if launchctl list | grep -q com.nanosparks.worker; then
  echo "✓ worker: already loaded"
else
  echo "▶ worker: loading launchd agent"
  launchctl load "$PLIST_DIR/com.nanosparks.worker.plist"
fi

# ── 4. Web ──
if launchctl list | grep -q com.nanosparks.web; then
  echo "✓ web: already loaded"
else
  echo "▶ web: loading launchd agent"
  launchctl load "$PLIST_DIR/com.nanosparks.web.plist"
fi

echo ""
echo "✅ nanosparks is up:"
echo "   web:        http://localhost:7557"
echo "   embedding:  http://127.0.0.1:8080/v1/embeddings"
echo "   logs:       $LOG_DIR/{web,worker,embedding}.{out,err}.log"
