-- Phase A1/A3: global transcription cache + reader + translation.
-- Creates GlobalEpisode + ReadingProgress, extends Source/Turn/Conversation,
-- and adds the SourcePlatform enum used by the resolver chain.

-- CreateEnum
CREATE TYPE "SourcePlatform" AS ENUM ('xiaoyuzhou', 'youtube', 'apple_podcasts', 'spotify', 'rss', 'bilibili', 'direct', 'generic');

-- AlterTable: Source — platform + public slug + host claim
ALTER TABLE "Source" ADD COLUMN "platform" "SourcePlatform",
                       ADD COLUMN "publicSlug" TEXT,
                       ADD COLUMN "claimedByUserId" TEXT;
CREATE UNIQUE INDEX "Source_publicSlug_key" ON "Source"("publicSlug");
CREATE INDEX "Source_platform_idx" ON "Source"("platform");

-- AlterTable: Conversation — global cache key + language + shared-cache flag
ALTER TABLE "Conversation" ADD COLUMN "episodeKey" TEXT,
                           ADD COLUMN "language" TEXT,
                           ADD COLUMN "isSharedCache" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "Conversation_episodeKey_key" ON "Conversation"("episodeKey");

-- AlterTable: Turn — per-language translation map (bilingual reader)
ALTER TABLE "Turn" ADD COLUMN "translationJson" JSONB;

-- CreateTable: GlobalEpisode (1:1 with the canonical shared Conversation)
CREATE TABLE "GlobalEpisode" (
    "id" TEXT NOT NULL,
    "episodeKey" TEXT NOT NULL,
    "platform" "SourcePlatform" NOT NULL,
    "platformId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "showTitle" TEXT,
    "coverUrl" TEXT,
    "durationSec" INTEGER,
    "sourceUrl" TEXT,
    "readCount" INTEGER NOT NULL DEFAULT 0,
    "firstIngestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlobalEpisode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GlobalEpisode_episodeKey_key" ON "GlobalEpisode"("episodeKey");
CREATE UNIQUE INDEX "GlobalEpisode_conversationId_key" ON "GlobalEpisode"("conversationId");
CREATE INDEX "GlobalEpisode_platform_idx" ON "GlobalEpisode"("platform");
CREATE INDEX "GlobalEpisode_readCount_idx" ON "GlobalEpisode"("readCount");
ALTER TABLE "GlobalEpisode" ADD CONSTRAINT "GlobalEpisode_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: ReadingProgress (per-user resume-read hook)
CREATE TABLE "ReadingProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "turnIndex" INTEGER NOT NULL DEFAULT 0,
    "scrollRatio" DOUBLE PRECISION,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReadingProgress_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReadingProgress_userId_conversationId_key" ON "ReadingProgress"("userId", "conversationId");
CREATE INDEX "ReadingProgress_conversationId_idx" ON "ReadingProgress"("conversationId");
ALTER TABLE "ReadingProgress" ADD CONSTRAINT "ReadingProgress_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
