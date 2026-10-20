-- 2026-10-19 iteration: stage timestamps so first-episode latency
-- (submit → readable → 导读) is measurable. Not backfilled; applies to runs
-- processed from this migration onward.
ALTER TABLE "Conversation" ADD COLUMN "transcribedAt" TIMESTAMP(3);
ALTER TABLE "Conversation" ADD COLUMN "analyzedAt" TIMESTAMP(3);
