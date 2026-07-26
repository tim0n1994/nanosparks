-- P0: L0 cross-episode speaker identity (Participant <-> Entity).
-- Links a per-conversation Participant to the cross-episode person Entity with a
-- confidence + provenance signals, so the distillation stack can query "what did
-- THIS person actually say?" across episodes. FTS search_tsv columns untouched.

CREATE TABLE IF NOT EXISTS "SpeakerIdentity" (
    "id" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "signalsJson" JSONB,
    "reviewedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SpeakerIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SpeakerIdentity_participantId_entityId_key"
    ON "SpeakerIdentity"("participantId", "entityId");
CREATE INDEX IF NOT EXISTS "SpeakerIdentity_entityId_idx" ON "SpeakerIdentity"("entityId");

ALTER TABLE "SpeakerIdentity"
    ADD CONSTRAINT "SpeakerIdentity_participantId_fkey"
    FOREIGN KEY ("participantId") REFERENCES "Participant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SpeakerIdentity"
    ADD CONSTRAINT "SpeakerIdentity_entityId_fkey"
    FOREIGN KEY ("entityId") REFERENCES "Entity"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
