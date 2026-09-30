-- Run independently outside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "PurchaseReturn_taxInvoiceDate_idx" ON "PurchaseReturn"("taxInvoiceDate");
