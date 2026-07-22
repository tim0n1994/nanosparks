-- Phase B1/C2/C3: publish packages, highlights, collections, follows.

-- CreateTable: PublishPackage (one content package per conversation+platform+variant)
CREATE TABLE "PublishPackage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "briefId" TEXT,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "copyText" TEXT NOT NULL,
    "assetsJson" JSONB,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "publishedUrl" TEXT,
    "costUsd" DOUBLE PRECISION DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublishPackage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PublishPackage_conversationId_platform_variant_key" ON "PublishPackage"("conversationId", "platform", "variant");
CREATE INDEX "PublishPackage_userId_idx" ON "PublishPackage"("userId");
CREATE INDEX "PublishPackage_platform_idx" ON "PublishPackage"("platform");
ALTER TABLE "PublishPackage" ADD CONSTRAINT "PublishPackage_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: Highlight (sentence-level highlights, reuses EvidenceSpan offsets)
CREATE TABLE "Highlight" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "turnId" TEXT,
    "startOffset" INTEGER NOT NULL DEFAULT 0,
    "endOffset" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Highlight_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Highlight_userId_idx" ON "Highlight"("userId");
CREATE INDEX "Highlight_conversationId_idx" ON "Highlight"("conversationId");
CREATE INDEX "Highlight_turnId_idx" ON "Highlight"("turnId");
ALTER TABLE "Highlight" ADD CONSTRAINT "Highlight_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Highlight" ADD CONSTRAINT "Highlight_turnId_fkey"
  FOREIGN KEY ("turnId") REFERENCES "Turn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: Collection + CollectionItem
CREATE TABLE "Collection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Collection_userId_idx" ON "Collection"("userId");

CREATE TABLE "CollectionItem" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "highlightId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CollectionItem_collectionId_highlightId_key" ON "CollectionItem"("collectionId", "highlightId");
CREATE INDEX "CollectionItem_collectionId_idx" ON "CollectionItem"("collectionId");
ALTER TABLE "CollectionItem" ADD CONSTRAINT "CollectionItem_collectionId_fkey"
  FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CollectionItem" ADD CONSTRAINT "CollectionItem_highlightId_fkey"
  FOREIGN KEY ("highlightId") REFERENCES "Highlight"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: Follow (show/topic subscriptions -> digest)
CREATE TABLE "Follow" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Follow_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Follow_userId_targetType_targetId_key" ON "Follow"("userId", "targetType", "targetId");
CREATE INDEX "Follow_userId_idx" ON "Follow"("userId");
CREATE INDEX "Follow_targetType_targetId_idx" ON "Follow"("targetType", "targetId");
