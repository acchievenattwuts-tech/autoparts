-- Run independently outside a transaction.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "ProductShelfLocation_productId_rackId_level_key" ON "ProductShelfLocation"("productId", "rackId", "level");
