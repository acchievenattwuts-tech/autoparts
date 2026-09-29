-- Run independently outside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "SupplierDebitNote_dueDate_status_idx" ON "SupplierDebitNote"("dueDate", "status");
