-- PRD 符合性补全：§5.4 归属可见性 + §5.5 校正回溯 + §7.1 L0 三信号 + §7.3 双时态 + §8 同名人 + §13.1 AI 集隔离
-- FTS search_tsv 列不受影响（raw-SQL 管理）。

-- §5.4/§5.5 Turn: 归属方法/置信/原始文本
ALTER TABLE "Turn" ADD COLUMN IF NOT EXISTS "rawText" TEXT;
ALTER TABLE "Turn" ADD COLUMN IF NOT EXISTS "attributionMethod" TEXT;
ALTER TABLE "Turn" ADD COLUMN IF NOT EXISTS "attributionConfidence" DOUBLE PRECISION;

-- §7.1 SpeakerIdentity: method/evidenceJson/reviewedAt；participantId 收紧为唯一
ALTER TABLE "SpeakerIdentity" ADD COLUMN IF NOT EXISTS "method" TEXT;
ALTER TABLE "SpeakerIdentity" ADD COLUMN IF NOT EXISTS "evidenceJson" JSONB;
ALTER TABLE "SpeakerIdentity" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3);
-- 先删旧的复合唯一约束，再加 participantId 唯一
ALTER TABLE "SpeakerIdentity" DROP CONSTRAINT IF EXISTS "SpeakerIdentity_participantId_entityId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "SpeakerIdentity_participantId_key" ON "SpeakerIdentity"("participantId");
CREATE INDEX IF NOT EXISTS "SpeakerIdentity_confidence_idx" ON "SpeakerIdentity"("confidence");

-- §7.3 PersonClaim 双时态
ALTER TABLE "PersonClaim" ADD COLUMN IF NOT EXISTS "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "PersonClaim" ADD COLUMN IF NOT EXISTS "supersededById" TEXT;
ALTER TABLE "PersonClaim" ADD COLUMN IF NOT EXISTS "supersededAt" TIMESTAMP(3);
ALTER TABLE "PersonClaim" ADD COLUMN IF NOT EXISTS "canonicalId" TEXT;
CREATE INDEX IF NOT EXISTS "PersonClaim_canonicalId_idx" ON "PersonClaim"("canonicalId");

-- §8 Entity 同名人区分
ALTER TABLE "Entity" ADD COLUMN IF NOT EXISTS "disambiguationJson" JSONB;

-- §13.1 Conversation AI 集隔离
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "isSynthetic" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "syntheticKind" TEXT;
