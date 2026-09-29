-- Run independently outside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "SupplierDebitNoteItem_debitNoteId_lineNo_idx" ON "SupplierDebitNoteItem"("debitNoteId", "lineNo");
