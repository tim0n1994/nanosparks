-- P3: L3 PersonFingerprint — versioned aggregation of a person's thought fingerprint.
-- coreClaims / stanceMap / style (evidence-type dist + hedge + concession) / lineage /
-- analogies / changes / coverage. Each rebuild = new version row (auditable history).
-- Every *Json array entry carries citations[] back to a turn+ms. FTS search_tsv untouched.

CREATE TABLE IF NOT EXISTS "PersonFingerprint" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "coreClaimsJson" JSONB NOT NULL,
    "stanceMapJson" JSONB NOT NULL,
    "styleJson" JSONB NOT NULL,
    "lineageJson" JSONB NOT NULL,
    "analogiesJson" JSONB NOT NULL,
    "changesJson" JSONB NOT NULL,
    "coverageJson" JSONB NOT NULL,
    "builtAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PersonFingerprint_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PersonFingerprint_entityId_version_key"
    ON "PersonFingerprint"("entityId", "version");
CREATE INDEX IF NOT EXISTS "PersonFingerprint_entityId_idx" ON "PersonFingerprint"("entityId");

ALTER TABLE "PersonFingerprint"
    ADD CONSTRAINT "PersonFingerprint_entityId_fkey"
    FOREIGN KEY ("entityId") REFERENCES "Entity"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
