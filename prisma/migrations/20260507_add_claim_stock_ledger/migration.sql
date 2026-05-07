-- Add a dedicated claim-stock ledger/balance layer so warranty movements do not
-- enter normal stock until a supplier replacement is accepted back to stock.

CREATE TYPE "ClaimStockMovementType" AS ENUM (
  'CUSTOMER_RETURN_IN',
  'SEND_TO_SUPPLIER_OUT',
  'SUPPLIER_RECEIVE_IN',
  'TRANSFER_TO_NORMAL_OUT',
  'SUPPLIER_REJECT',
  'SUPPLIER_CREDIT_SETTLE',
  'SCRAP_OUT',
  'CANCEL_REVERSAL'
);

CREATE TABLE "ClaimStockBalance" (
  "id" TEXT NOT NULL,
  "claimId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "lotNo" TEXT NOT NULL DEFAULT '',
  "qtyOnHand" DECIMAL(12,4) NOT NULL DEFAULT 0,
  "unitCost" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ClaimStockBalance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClaimStockMovement" (
  "id" TEXT NOT NULL,
  "claimId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "movementType" "ClaimStockMovementType" NOT NULL,
  "docNo" TEXT NOT NULL,
  "docDate" TIMESTAMP(3) NOT NULL,
  "lotNo" TEXT NOT NULL DEFAULT '',
  "qtyIn" DECIMAL(12,4) NOT NULL DEFAULT 0,
  "qtyOut" DECIMAL(12,4) NOT NULL DEFAULT 0,
  "unitCost" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "detail" TEXT,
  "stockCardId" TEXT,
  "purchaseReturnId" TEXT,
  "reversalOfId" TEXT,
  "reversedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ClaimStockMovement_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PurchaseReturn" ADD COLUMN "claimId" TEXT;

CREATE UNIQUE INDEX "ClaimStockBalance_claimId_productId_lotNo_key"
  ON "ClaimStockBalance"("claimId", "productId", "lotNo");
CREATE INDEX "ClaimStockBalance_productId_idx" ON "ClaimStockBalance"("productId");
CREATE INDEX "ClaimStockBalance_claimId_idx" ON "ClaimStockBalance"("claimId");

CREATE INDEX "ClaimStockMovement_claimId_docDate_idx" ON "ClaimStockMovement"("claimId", "docDate");
CREATE INDEX "ClaimStockMovement_productId_idx" ON "ClaimStockMovement"("productId");
CREATE INDEX "ClaimStockMovement_movementType_idx" ON "ClaimStockMovement"("movementType");
CREATE INDEX "ClaimStockMovement_stockCardId_idx" ON "ClaimStockMovement"("stockCardId");
CREATE INDEX "ClaimStockMovement_purchaseReturnId_idx" ON "ClaimStockMovement"("purchaseReturnId");
CREATE INDEX "PurchaseReturn_claimId_idx" ON "PurchaseReturn"("claimId");

ALTER TABLE "ClaimStockBalance"
  ADD CONSTRAINT "ClaimStockBalance_claimId_fkey"
  FOREIGN KEY ("claimId") REFERENCES "WarrantyClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClaimStockBalance"
  ADD CONSTRAINT "ClaimStockBalance_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ClaimStockMovement"
  ADD CONSTRAINT "ClaimStockMovement_claimId_fkey"
  FOREIGN KEY ("claimId") REFERENCES "WarrantyClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClaimStockMovement"
  ADD CONSTRAINT "ClaimStockMovement_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ClaimStockMovement"
  ADD CONSTRAINT "ClaimStockMovement_stockCardId_fkey"
  FOREIGN KEY ("stockCardId") REFERENCES "StockCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PurchaseReturn"
  ADD CONSTRAINT "PurchaseReturn_claimId_fkey"
  FOREIGN KEY ("claimId") REFERENCES "WarrantyClaim"("id") ON DELETE SET NULL ON UPDATE CASCADE;
