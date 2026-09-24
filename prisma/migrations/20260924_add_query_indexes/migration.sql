-- Read-path indexes from the 2026-09 code review (items #158, #165-#169).
-- Index-only and additive: no data or query result changes.
-- Applied with narrow SQL rather than `prisma db push`, because the push still
-- proposes dropping `product_search_documents.trgm_text` and the search indexes
-- (see docs/specs/sales-quotations.md). Names match Prisma's defaults so the
-- schema's @@index entries line up with the database.
-- CONCURRENTLY: never blocks writes; must run outside a transaction, one
-- statement at a time.

-- LINE AI reconcile cron: OUTBOUND rows still PENDING, oldest first.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "LineMessage_deliveryStatus_createdAt_idx" ON "LineMessage"("deliveryStatus", "createdAt");

-- LINE AI job worker claim / stale sweep / retention: by status, oldest first.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "LineAiJob_status_createdAt_idx" ON "LineAiJob"("status", "createdAt");

-- StockCard lookups by source document (audit snapshots, balance forward).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "StockCard_referenceId_idx" ON "StockCard"("referenceId");

-- Purchases by supplier (newest first) and purchase lines by product.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Purchase_supplierId_purchaseDate_idx" ON "Purchase"("supplierId", "purchaseDate" DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "PurchaseItem_productId_idx" ON "PurchaseItem"("productId");

-- Customer credit notes by status.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "CreditNote_customerId_status_idx" ON "CreditNote"("customerId", "status");

-- Lot movement trace: document lines by product, lot rows by lot number.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "CreditNoteItem_productId_idx" ON "CreditNoteItem"("productId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "PurchaseReturnItem_productId_idx" ON "PurchaseReturnItem"("productId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "PurchaseItemLot_lotNo_idx" ON "PurchaseItemLot"("lotNo");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "SaleItemLot_lotNo_idx" ON "SaleItemLot"("lotNo");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "PurchaseReturnItemLot_lotNo_idx" ON "PurchaseReturnItemLot"("lotNo");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "CreditNoteItemLot_lotNo_idx" ON "CreditNoteItemLot"("lotNo");
