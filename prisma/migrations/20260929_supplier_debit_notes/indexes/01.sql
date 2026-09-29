-- Run independently outside a transaction.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "SupplierDebitNote_debitNo_key" ON "SupplierDebitNote"("debitNo");
