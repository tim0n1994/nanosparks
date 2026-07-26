-- P-1: Persist pyannote diarization segments (who spoke when).
-- Previously diarize.ts discarded result.segments and only stored a count in
-- Source.retentionPolicy, forcing normalize_turns to reverse-engineer segments
-- from already-attributed turns — a bootstrap deadlock that left ~98.4% of Turns
-- with participantId = null. This table is the real input to speaker attribution
-- (L1 of the person-distillation stack). FTS `search_tsv` columns untouched.

CREATE TABLE IF NOT EXISTS "DiarizationSegment" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiarizationSegment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DiarizationSegment_conversationId_idx" ON "DiarizationSegment"("conversationId");
CREATE INDEX IF NOT EXISTS "DiarizationSegment_conversationId_label_idx" ON "DiarizationSegment"("conversationId", "label");

ALTER TABLE "DiarizationSegment"
    ADD CONSTRAINT "DiarizationSegment_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
