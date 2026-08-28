CREATE TYPE "PricePromotionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED');
CREATE TYPE "SalePriceSource" AS ENUM ('NORMAL_PRICE', 'PROMOTION', 'MANUAL', 'ORDER_SNAPSHOT');

CREATE TABLE "PricePromotion" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "priceListId" TEXT NOT NULL,
  "startDate" TIMESTAMPTZ(3) NOT NULL,
  "endDate" TIMESTAMPTZ(3) NOT NULL,
  "status" "PricePromotionStatus" NOT NULL DEFAULT 'DRAFT',
  "note" TEXT,
  "createdById" TEXT NOT NULL,
  "publishedById" TEXT,
  "cancelledById" TEXT,
  "publishedAt" TIMESTAMPTZ(3),
  "cancelledAt" TIMESTAMPTZ(3),
  "cancelNote" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "PricePromotion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PricePromotion_date_order_check" CHECK ("endDate" >= "startDate")
);

CREATE TABLE "PricePromotionItem" (
  "id" TEXT NOT NULL,
  "promotionId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "normalReferencePrice" DECIMAL(10,2) NOT NULL,
  "promotionPrice" DECIMAL(10,2) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "PricePromotionItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PricePromotionItem_normal_nonnegative_check" CHECK ("normalReferencePrice" >= 0),
  CONSTRAINT "PricePromotionItem_promotion_nonnegative_check" CHECK ("promotionPrice" >= 0)
);

ALTER TABLE "SaleItem"
  ADD COLUMN "priceListId" TEXT,
  ADD COLUMN "pricePromotionId" TEXT,
  ADD COLUMN "priceSource" "SalePriceSource";

CREATE INDEX "PricePromotion_priceListId_status_startDate_endDate_idx"
  ON "PricePromotion"("priceListId", "status", "startDate", "endDate");
CREATE INDEX "PricePromotion_status_startDate_endDate_idx"
  ON "PricePromotion"("status", "startDate", "endDate");
CREATE UNIQUE INDEX "PricePromotionItem_promotionId_productId_key"
  ON "PricePromotionItem"("promotionId", "productId");
CREATE INDEX "PricePromotionItem_productId_promotionId_idx"
  ON "PricePromotionItem"("productId", "promotionId");
CREATE INDEX "SaleItem_priceListId_idx" ON "SaleItem"("priceListId");
CREATE INDEX "SaleItem_pricePromotionId_idx" ON "SaleItem"("pricePromotionId");

ALTER TABLE "PricePromotion"
  ADD CONSTRAINT "PricePromotion_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PricePromotion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PricePromotion_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PricePromotion_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PricePromotionItem"
  ADD CONSTRAINT "PricePromotionItem_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "PricePromotion"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "PricePromotionItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SaleItem"
  ADD CONSTRAINT "SaleItem_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "SaleItem_pricePromotionId_fkey" FOREIGN KEY ("pricePromotionId") REFERENCES "PricePromotion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
