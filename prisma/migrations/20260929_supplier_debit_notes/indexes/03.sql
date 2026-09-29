-- Run independently outside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "SupplierDebitNote_supplierId_status_idx" ON "SupplierDebitNote"("supplierId", "status");
