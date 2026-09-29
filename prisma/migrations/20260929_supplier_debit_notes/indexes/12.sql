-- Run independently outside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "SupplierDebitNoteItem_productId_idx" ON "SupplierDebitNoteItem"("productId");
