-- V2/T-V2-1 + M3: entity layer (Entity, EntityMention, CanonicalClaim),
-- GraphNode.entityId link, and EmbeddingProjection for the semantic star map.
-- NOTE: FTS `search_tsv` columns (Turn/ThoughtUnit) are raw-SQL managed and untouched.

-- GraphNode ↔ Entity link
ALTER TABLE "GraphNode" ADD COLUMN IF NOT EXISTS "entityId" TEXT;
CREATE INDEX IF NOT EXISTS "GraphNode_entityId_idx" ON "GraphNode"("entityId");

-- Entity
CREATE TABLE IF NOT EXISTS "Entity" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "canonicalName" TEXT NOT NULL,
    "aliasesJson" JSONB,
    "embeddingId" TEXT,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Entity_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Entity_workspaceId_type_canonicalName_key" ON "Entity"("workspaceId", "type", "canonicalName");
CREATE INDEX IF NOT EXISTS "Entity_workspaceId_type_idx" ON "Entity"("workspaceId", "type");
ALTER TABLE "Entity" ADD CONSTRAINT "Entity_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- EntityMention
CREATE TABLE IF NOT EXISTS "EntityMention" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "turnId" TEXT,
    "surfaceForm" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EntityMention_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "EntityMention_entityId_idx" ON "EntityMention"("entityId");
CREATE INDEX IF NOT EXISTS "EntityMention_conversationId_idx" ON "EntityMention"("conversationId");
ALTER TABLE "EntityMention" ADD CONSTRAINT "EntityMention_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntityMention" ADD CONSTRAINT "EntityMention_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntityMention" ADD CONSTRAINT "EntityMention_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "Turn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CanonicalClaim
CREATE TABLE IF NOT EXISTS "CanonicalClaim" (
    "id" TEXT NOT NULL,
    "corpusId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "memberTuIdsJson" JSONB NOT NULL,
    "entityIdsJson" JSONB,
    "firstAssertedAt" TIMESTAMP(3),
    "lastAssertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CanonicalClaim_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CanonicalClaim_corpusId_idx" ON "CanonicalClaim"("corpusId");
ALTER TABLE "CanonicalClaim" ADD CONSTRAINT "CanonicalClaim_corpusId_fkey" FOREIGN KEY ("corpusId") REFERENCES "Corpus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- EmbeddingProjection (M3)
CREATE TABLE IF NOT EXISTS "EmbeddingProjection" (
    "id" TEXT NOT NULL,
    "corpusId" TEXT NOT NULL,
    "embeddingId" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "z" DOUBLE PRECISION,
    "clusterId" INTEGER,
    "clusterLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmbeddingProjection_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "EmbeddingProjection_corpusId_idx" ON "EmbeddingProjection"("corpusId");
CREATE INDEX IF NOT EXISTS "EmbeddingProjection_corpusId_clusterId_idx" ON "EmbeddingProjection"("corpusId", "clusterId");
ALTER TABLE "EmbeddingProjection" ADD CONSTRAINT "EmbeddingProjection_corpusId_fkey" FOREIGN KEY ("corpusId") REFERENCES "Corpus"("id") ON DELETE CASCADE ON UPDATE CASCADE;
