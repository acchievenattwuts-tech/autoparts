-- Additive compatibility migration. Existing Product price columns and
-- CustomerType.priceTier remain the active source until the verified cutover.
CREATE TABLE "PriceList" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "channel" "SaleChannel",
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "isSystem" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "PriceList_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductPrice" (
  "productId" TEXT NOT NULL,
  "priceListId" TEXT NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ProductPrice_pkey" PRIMARY KEY ("productId", "priceListId"),
  CONSTRAINT "ProductPrice_amount_nonnegative_check" CHECK ("amount" >= 0)
);

ALTER TABLE "CustomerType" ADD COLUMN "priceListId" TEXT;

CREATE UNIQUE INDEX "PriceList_code_key" ON "PriceList"("code");
CREATE UNIQUE INDEX "PriceList_name_key" ON "PriceList"("name");
CREATE UNIQUE INDEX "PriceList_channel_key" ON "PriceList"("channel");
CREATE INDEX "PriceList_isActive_sortOrder_idx" ON "PriceList"("isActive", "sortOrder");
CREATE INDEX "ProductPrice_priceListId_productId_idx" ON "ProductPrice"("priceListId", "productId");
CREATE INDEX "CustomerType_priceListId_idx" ON "CustomerType"("priceListId");

ALTER TABLE "ProductPrice"
  ADD CONSTRAINT "ProductPrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ProductPrice_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CustomerType"
  ADD CONSTRAINT "CustomerType_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE SET NULL ON UPDATE CASCADE;
