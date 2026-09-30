-- Run independently outside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "SupplierDebitNote_adjustsDebitNoteId_idx" ON "SupplierDebitNote"("adjustsDebitNoteId");
