-- Embedding dimension upgrade: 512 → 1024 (BGE-M3 native)
-- Table was 0 rows at migration time, no data backfill needed.
DROP INDEX IF EXISTS embeddings_vector_idx;
ALTER TABLE embeddings ALTER COLUMN embedding TYPE vector(1024);
CREATE INDEX embeddings_vector_idx ON embeddings USING hnsw (embedding vector_cosine_ops);
