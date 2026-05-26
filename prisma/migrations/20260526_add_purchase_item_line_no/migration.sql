ALTER TABLE "PurchaseItem"
  ADD COLUMN IF NOT EXISTS "lineNo" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "PurchaseItem_purchaseId_lineNo_idx"
  ON "PurchaseItem"("purchaseId", "lineNo");
