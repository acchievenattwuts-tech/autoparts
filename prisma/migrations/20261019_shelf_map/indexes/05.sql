-- Run independently outside a transaction.
-- At most one primary ("home") location per product. schema.prisma cannot express a partial
-- index, so scripts/check-schema-drift.ts allowlists its DROP in KNOWN_UNMODELED_DRIFT_STATEMENTS.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "ProductShelfLocation_one_primary_per_product_key" ON "ProductShelfLocation"("productId") WHERE "isPrimary";
