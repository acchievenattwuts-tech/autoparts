-- Run independently outside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "SupplierDebitNote_userId_idx" ON "SupplierDebitNote"("userId");
