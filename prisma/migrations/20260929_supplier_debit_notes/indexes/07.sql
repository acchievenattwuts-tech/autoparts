-- Run independently outside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "SupplierDebitNote_debitDate_idx" ON "SupplierDebitNote"("debitDate");
