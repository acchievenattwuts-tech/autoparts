-- Run independently outside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "SupplierDebitNote_receivedDate_idx" ON "SupplierDebitNote"("receivedDate");
