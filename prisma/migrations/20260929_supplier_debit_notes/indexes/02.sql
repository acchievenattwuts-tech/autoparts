-- Run independently outside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "SupplierDebitNote_purchaseId_status_idx" ON "SupplierDebitNote"("purchaseId", "status");
