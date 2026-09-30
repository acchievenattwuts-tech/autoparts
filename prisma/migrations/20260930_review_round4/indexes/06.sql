-- Run independently outside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Purchase_taxInvoiceDate_idx" ON "Purchase"("taxInvoiceDate");
