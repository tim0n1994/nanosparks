-- Phase 4: PII Redaction + Semantic Search
-- 
-- 1. Enable pgvector extension
-- 2. Create embeddings table for vector search
-- 3. Add clean_text column to Turn model for PII-redacted text

-- 1. Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Create embeddings table
CREATE TABLE "embeddings" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "embedding" vector(512) NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'text-embedding-3-small',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "embeddings_pkey" PRIMARY KEY ("id")
);

-- Create unique index for upsert operations
CREATE UNIQUE INDEX "embeddings_resource_type_resource_id_key" ON "embeddings"("resource_type", "resource_id");

-- Create HNSW index for fast approximate nearest neighbor search
-- (ivfflat is also an option but hnsw has better query performance at the cost of slower index build)
CREATE INDEX "embeddings_vector_idx" ON "embeddings" USING hnsw ("embedding" vector_cosine_ops);

-- Create index on resource_type for filtering
CREATE INDEX "embeddings_resource_type_idx" ON "embeddings"("resource_type");

-- 3. Add clean_text column to Turn for PII-redacted transcript text
ALTER TABLE "Turn" ADD COLUMN IF NOT EXISTS "clean_text" TEXT;

-- Add index for vector searches by resource type
CREATE INDEX "embeddings_resource_id_idx" ON "embeddings"("resource_id");
