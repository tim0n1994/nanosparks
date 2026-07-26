-- P2: L2 PersonClaim (claim attributed to a person, dual-temporal) + ThoughtUnit
-- attribution fields. Promotes a person's own type=claim ThoughtUnits into
-- PersonClaims with first/lastAssertedAt for the stance timeline (P4).
-- EvidenceSpan already points ThoughtUnit->Turn+ms, so claims stay auditable.
-- FTS search_tsv columns untouched.

ALTER TABLE "ThoughtUnit" ADD COLUMN IF NOT EXISTS "modality" TEXT;
ALTER TABLE "ThoughtUnit" ADD COLUMN IF NOT EXISTS "evidenceType" TEXT;
ALTER TABLE "ThoughtUnit" ADD COLUMN IF NOT EXISTS "polarity" DOUBLE PRECISION;

CREATE TABLE IF NOT EXISTS "PersonClaim" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "sourceThoughtUnitId" TEXT,
    "text" TEXT NOT NULL,
    "stance" TEXT NOT NULL,
    "modality" TEXT,
    "evidenceType" TEXT,
    "polarity" DOUBLE PRECISION,
    "firstAssertedAt" TIMESTAMP(3),
    "lastAssertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PersonClaim_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PersonClaim_entityId_idx" ON "PersonClaim"("entityId");
CREATE INDEX IF NOT EXISTS "PersonClaim_sourceThoughtUnitId_idx" ON "PersonClaim"("sourceThoughtUnitId");

ALTER TABLE "PersonClaim"
    ADD CONSTRAINT "PersonClaim_entityId_fkey"
    FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
