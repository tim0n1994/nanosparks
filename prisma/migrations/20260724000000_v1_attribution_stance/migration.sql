-- V1/T-V1-1: speaker attribution + argument stance on ThoughtUnit.
-- Links each thought unit to the Participant who asserted it and records the
-- argumentative stance (assert | oppose | question | concede | neutral) so the
-- reader L0 visualizations (speaker swimlanes, argument thread coloring) work.
-- NOTE: the FTS `search_tsv` columns on Turn/ThoughtUnit are managed via raw
-- SQL outside schema.prisma and are intentionally not touched here.

ALTER TABLE "ThoughtUnit" ADD COLUMN IF NOT EXISTS "participantId" TEXT;
ALTER TABLE "ThoughtUnit" ADD COLUMN IF NOT EXISTS "stance" TEXT;

CREATE INDEX IF NOT EXISTS "ThoughtUnit_participantId_idx" ON "ThoughtUnit"("participantId");

ALTER TABLE "ThoughtUnit" DROP CONSTRAINT IF EXISTS "ThoughtUnit_participantId_fkey";
ALTER TABLE "ThoughtUnit" ADD CONSTRAINT "ThoughtUnit_participantId_fkey"
  FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
