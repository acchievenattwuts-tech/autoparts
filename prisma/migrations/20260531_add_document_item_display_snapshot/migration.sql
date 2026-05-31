ALTER TABLE "PurchaseItem"
  ADD COLUMN "showQty" DECIMAL(12,4),
  ADD COLUMN "showUnitName" TEXT,
  ADD COLUMN "showPricePerUnit" DECIMAL(10,2),
  ADD COLUMN "unitScale" DECIMAL(12,4);

ALTER TABLE "SaleItem"
  ADD COLUMN "showQty" DECIMAL(12,4),
  ADD COLUMN "showUnitName" TEXT,
  ADD COLUMN "showPricePerUnit" DECIMAL(10,2),
  ADD COLUMN "unitScale" DECIMAL(12,4);

ALTER TABLE "CreditNoteItem"
  ADD COLUMN "showQty" DECIMAL(12,4),
  ADD COLUMN "showUnitName" TEXT,
  ADD COLUMN "showPricePerUnit" DECIMAL(10,2),
  ADD COLUMN "unitScale" DECIMAL(12,4);

ALTER TABLE "PurchaseReturnItem"
  ADD COLUMN "showQty" DECIMAL(12,4),
  ADD COLUMN "showUnitName" TEXT,
  ADD COLUMN "showPricePerUnit" DECIMAL(10,2),
  ADD COLUMN "unitScale" DECIMAL(12,4);
