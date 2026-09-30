-- Run independently outside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "SupplierDebitNote_cashBankAccountId_idx" ON "SupplierDebitNote"("cashBankAccountId");
