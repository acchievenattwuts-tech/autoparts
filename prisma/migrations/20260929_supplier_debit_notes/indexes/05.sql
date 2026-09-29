-- Run independently outside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "SupplierDebitNote_postingDate_status_idx" ON "SupplierDebitNote"("postingDate", "status");
