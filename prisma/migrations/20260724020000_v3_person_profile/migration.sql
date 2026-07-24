-- V3: PersonProfile (aggregated from person Entities) + SpeakerVoiceprint.
-- chatEnabled is the hard gate for persona chat (<3 episodes / sensitive → false).

CREATE TABLE IF NOT EXISTS "PersonProfile" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "statsJson" JSONB,
    "styleJson" JSONB,
    "relationsJson" JSONB,
    "summaryText" TEXT,
    "claimed" BOOLEAN NOT NULL DEFAULT false,
    "claimedByUserId" TEXT,
    "chatEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PersonProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PersonProfile_entityId_key" ON "PersonProfile"("entityId");
CREATE INDEX IF NOT EXISTS "PersonProfile_claimed_idx" ON "PersonProfile"("claimed");
ALTER TABLE "PersonProfile" ADD CONSTRAINT "PersonProfile_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "SpeakerVoiceprint" (
    "id" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "embeddingJson" JSONB NOT NULL,
    "sampleMetaJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SpeakerVoiceprint_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SpeakerVoiceprint_participantId_idx" ON "SpeakerVoiceprint"("participantId");
