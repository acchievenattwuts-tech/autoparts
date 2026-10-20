-- Run independently outside a transaction.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "ShelfRack_code_key" ON "ShelfRack"("code");
