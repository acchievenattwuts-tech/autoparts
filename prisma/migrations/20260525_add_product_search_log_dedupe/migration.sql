-- ProductSearchLog dedupe support
-- Adds hitCount/dedupeKey/updatedAt so repeated identical searches within the
-- same hour bucket upsert into a single row (incrementing hitCount) instead of
-- bloating the table with duplicate rows.

ALTER TABLE "ProductSearchLog"
  ADD COLUMN IF NOT EXISTS "hitCount" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "dedupeKey" VARCHAR(280),
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Historical rows keep dedupeKey = NULL so they never collide with new buckets.
-- Postgres treats NULL values as distinct in unique indexes by default, so
-- multiple legacy NULL rows are allowed alongside the unique constraint.
CREATE UNIQUE INDEX IF NOT EXISTS "ProductSearchLog_dedupeKey_key"
  ON "ProductSearchLog"("dedupeKey");
