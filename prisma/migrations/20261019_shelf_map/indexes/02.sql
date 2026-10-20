-- Run independently outside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ShelfRack_isActive_sortOrder_idx" ON "ShelfRack"("isActive", "sortOrder");
