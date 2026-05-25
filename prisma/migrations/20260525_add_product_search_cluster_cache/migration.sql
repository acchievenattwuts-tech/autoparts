-- ProductSearchClusterCache: materialized aggregation of ProductSearchLog
-- clusters for rolling windows ("last-7-days", "last-30-days"). Lets the
-- Product Search Quality report skip the 500-row in-memory aggregation when
-- the admin's date filter matches a cached rolling window. Refresh is triggered
-- manually from the report UI.

CREATE TABLE IF NOT EXISTS "ProductSearchClusterCache" (
  "id"               TEXT PRIMARY KEY,
  "windowKey"        VARCHAR(20) NOT NULL,
  "normalizedQuery"  VARCHAR(200) NOT NULL,
  "candidateAction"  VARCHAR(50) NOT NULL,
  "bucket"           VARCHAR(20) NOT NULL,
  "count"            INTEGER NOT NULL,
  "minResultCount"   INTEGER NOT NULL,
  "avgResultCount"   DECIMAL(10, 2) NOT NULL,
  "latestAt"         TIMESTAMPTZ(3) NOT NULL,
  "rawQueriesSample" JSONB NOT NULL,
  "sourceCounts"     JSONB NOT NULL,
  "windowStart"      TIMESTAMPTZ(3) NOT NULL,
  "windowEnd"        TIMESTAMPTZ(3) NOT NULL,
  "computedAt"       TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductSearchClusterCache_window_query_action_key"
  ON "ProductSearchClusterCache"("windowKey", "normalizedQuery", "candidateAction");

CREATE INDEX IF NOT EXISTS "ProductSearchClusterCache_window_computedAt_idx"
  ON "ProductSearchClusterCache"("windowKey", "computedAt");
