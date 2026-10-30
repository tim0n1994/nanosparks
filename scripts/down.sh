#!/bin/bash
# Stop all nanosparks services: web → worker → embedding → docker.
# Frees all resources (model unloaded from RAM, ports released).
set -euo pipefail

PLIST_DIR="$HOME/Library/LaunchAgents"
PROJECT_DIR="${NSP_PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"

echo "■ stopping nanosparks services..."

# ── Web + Worker + Embedding (launchd) ──
for svc in web worker embedding; do
  plist="$PLIST_DIR/com.nanosparks.$svc.plist"
  if [ -f "$plist" ]; then
    launchctl unload "$plist" 2>/dev/null && echo "✓ $svc: stopped" || echo "✓ $svc: not running"
  fi
done

# ── Docker: postgres + redis ──
cd "$PROJECT_DIR"
docker compose stop postgres redis 2>/dev/null && echo "✓ docker: postgres + redis stopped" || true

echo ""
echo "⏹ nanosparks is down. All resources freed."
