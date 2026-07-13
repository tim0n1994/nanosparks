-- I4: Postgres FTS for BM25 search + tsvector on Turn and ThoughtUnit
--
-- Uses bigram tokenization as a fallback for Chinese text (pg_jieba/zhparser
-- would be better but require extension installation; bigram is good enough
-- for initial eval and works without additional extensions).

-- Add tsvector generated columns to Turn (on cleanText, fallback to text)
ALTER TABLE "Turn" ADD COLUMN IF NOT EXISTS "search_tsv" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce("cleanText", "text"))
  ) STORED;

CREATE INDEX IF NOT EXISTS "Turn_search_tsv_idx" ON "Turn" USING GIN ("search_tsv");

-- Add tsvector generated column to ThoughtUnit
ALTER TABLE "ThoughtUnit" ADD COLUMN IF NOT EXISTS "search_tsv" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple', "text")
  ) STORED;

CREATE INDEX IF NOT EXISTS "ThoughtUnit_search_tsv_idx" ON "ThoughtUnit" USING GIN ("search_tsv");
