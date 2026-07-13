-- AlterTable: add wordsJson to Turn for word-level timestamps
ALTER TABLE "Turn" ADD COLUMN "wordsJson" JSONB;

-- CreateTable: ExtractionRun
CREATE TABLE "ExtractionRun" (
    "id" TEXT NOT NULL,
    "corpusId" TEXT,
    "conversationId" TEXT,
    "kind" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT,
    "params" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "costUsd" DOUBLE PRECISION DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ExtractionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Brief
CREATE TABLE "Brief" (
    "id" TEXT NOT NULL,
    "corpusId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sectionsJson" JSONB NOT NULL,
    "sourceRunId" TEXT,
    "shareId" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brief_pkey" PRIMARY KEY ("id")
);

-- CreateTable: AuditLog
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- AlterTable: add runId to ThoughtUnit
ALTER TABLE "ThoughtUnit" ADD COLUMN "runId" TEXT;

-- CreateIndex
CREATE INDEX "ExtractionRun_corpusId_idx" ON "ExtractionRun"("corpusId");
CREATE INDEX "ExtractionRun_conversationId_idx" ON "ExtractionRun"("conversationId");
CREATE INDEX "ExtractionRun_kind_idx" ON "ExtractionRun"("kind");
CREATE INDEX "ExtractionRun_isActive_idx" ON "ExtractionRun"("isActive");

CREATE INDEX "Brief_corpusId_idx" ON "Brief"("corpusId");
CREATE UNIQUE INDEX "Brief_shareId_key" ON "Brief"("shareId");

CREATE INDEX "AuditLog_workspaceId_idx" ON "AuditLog"("workspaceId");
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");
CREATE INDEX "AuditLog_resourceType_resourceId_idx" ON "AuditLog"("resourceType", "resourceId");

CREATE INDEX "ThoughtUnit_runId_idx" ON "ThoughtUnit"("runId");

-- AddForeignKey
ALTER TABLE "ExtractionRun" ADD CONSTRAINT "ExtractionRun_corpusId_fkey"
    FOREIGN KEY ("corpusId") REFERENCES "Corpus"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExtractionRun" ADD CONSTRAINT "ExtractionRun_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Brief" ADD CONSTRAINT "Brief_corpusId_fkey"
    FOREIGN KEY ("corpusId") REFERENCES "Corpus"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ThoughtUnit" ADD CONSTRAINT "ThoughtUnit_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "ExtractionRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
