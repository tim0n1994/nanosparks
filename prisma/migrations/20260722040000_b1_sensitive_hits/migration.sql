-- Phase B1: persist sensitive-word hit count on PublishPackage for UI highlight.
ALTER TABLE "PublishPackage" ADD COLUMN "sensitiveHits" INTEGER NOT NULL DEFAULT 0;
