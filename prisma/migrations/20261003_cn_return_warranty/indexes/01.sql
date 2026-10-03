-- Run independently outside a transaction.
-- Lookup of the warranties a credit note cancelled (restore on CN cancel/edit, admin and LIFF links).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Warranty_cancelledByCreditNoteId_idx" ON "Warranty"("cancelledByCreditNoteId");
