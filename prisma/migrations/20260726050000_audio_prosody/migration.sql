-- §13.3: audio prosody slot (second source for multi-source fusion; emotion activation).
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "audioProsodyJson" JSONB;
