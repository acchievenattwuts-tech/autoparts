-- Run independently outside a transaction.
-- D10: DN existence / later-DN lookups filter StockCard by productId + source + docDate.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "StockCard_productId_source_docDate_idx" ON "StockCard"("productId", "source", "docDate");
