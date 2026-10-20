-- Run independently outside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ProductShelfLocation_rackId_level_idx" ON "ProductShelfLocation"("rackId", "level");
