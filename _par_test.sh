#!/bin/bash
HDR1="-H Content-Type:application/json -H x-api-key:ccr-dev-4ef350c6caff -H anthropic-version:2023-06-01"
BODY1='{"model":"glm-5.2","max_tokens":50,"messages":[{"role":"user","content":"Write a 30 word paragraph about cats"}]}'
BODY2='{"model":"glm-5.1","max_tokens":50,"messages":[{"role":"user","content":"Write a 30 word paragraph about dogs"}]}'
t0=$(python3 -c 'import time;print(int(time.time()*1000))')
echo "--- 同时发 2 个 primary（同端点竞争）---"
curl -sS -o /dev/null -w "  p1: %{time_total}s\n" --max-time 30 -X POST http://127.0.0.1:3458/v1/messages $HDR1 -d "$BODY1" &
curl -sS -o /dev/null -w "  p2: %{time_total}s\n" --max-time 30 -X POST http://127.0.0.1:3458/v1/messages $HDR1 -d "$BODY1" &
wait
t1=$(python3 -c 'import time;print(int(time.time()*1000))')
echo "  2x primary 总墙钟: $((t1-t0))ms"
t0=$t1
echo "--- 同时发 primary+secondary（不同端点）---"
curl -sS -o /dev/null -w "  primary:   %{time_total}s\n" --max-time 30 -X POST http://127.0.0.1:3458/v1/messages $HDR1 -d "$BODY1" &
curl -sS -o /dev/null -w "  secondary: %{time_total}s\n" --max-time 30 -X POST http://127.0.0.1:3458/v1/messages-2 $HDR1 -d "$BODY2" &
wait
t1=$(python3 -c 'import time;print(int(time.time()*1000))')
echo "  primary+secondary 总墙钟: $((t1-t0))ms"
