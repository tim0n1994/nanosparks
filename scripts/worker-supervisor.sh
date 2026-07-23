#!/usr/bin/env bash
# Restarts the BullMQ worker if it exits. Logs each (re)start.
cd /Users/chillbit/Proj/nanosparks
LOG=/tmp/nanosparks-worker.log
echo "[supervisor] $(date -Iseconds) starting supervisor pid $$" >> "$LOG"
while true; do
  echo "[supervisor] $(date -Iseconds) launching worker" >> "$LOG"
  npx tsx src/lib/queue/worker.ts >> "$LOG" 2>&1
  code=$?
  echo "[supervisor] $(date -Iseconds) worker exited with code $code — restarting in 3s" >> "$LOG"
  sleep 3
done
