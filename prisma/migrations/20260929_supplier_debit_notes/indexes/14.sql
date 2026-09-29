-- Run independently outside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "SupplierPaymentItem_debitNoteId_idx" ON "SupplierPaymentItem"("debitNoteId");
