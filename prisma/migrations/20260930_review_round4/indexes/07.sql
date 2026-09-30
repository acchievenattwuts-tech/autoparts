-- Run independently outside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Expense_taxInvoiceDate_idx" ON "Expense"("taxInvoiceDate");
