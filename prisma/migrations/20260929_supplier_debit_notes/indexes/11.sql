-- Run independently outside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "SupplierDebitNoteItem_purchaseItemId_idx" ON "SupplierDebitNoteItem"("purchaseItemId");
