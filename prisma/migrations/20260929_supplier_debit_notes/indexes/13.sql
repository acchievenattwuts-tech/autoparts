-- Run independently outside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "SupplierDebitNoteItem_stockCardId_idx" ON "SupplierDebitNoteItem"("stockCardId");
