-- Additive SQ schema only; excludes unrelated search schema drift.
BEGIN;
SET LOCAL lock_timeout = '5s';
-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "activeQuotationId" TEXT,
ADD COLUMN     "quotationId" TEXT,
ADD COLUMN     "quotationRevision" INTEGER;

-- CreateTable
CREATE TABLE "SalesQuotation" (
    "revision" INTEGER NOT NULL DEFAULT 0,
    "id" TEXT NOT NULL,
    "quotationNo" TEXT NOT NULL,
    "quotationDate" TIMESTAMPTZ(3) NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT,
    "customerAddress" TEXT,
    "creditTerm" INTEGER NOT NULL DEFAULT 0,
    "saleType" "SaleType" NOT NULL DEFAULT 'RETAIL',
    "discount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "subtotalAmount" DECIMAL(10,2) NOT NULL,
    "vatAmount" DECIMAL(10,2) NOT NULL,
    "netAmount" DECIMAL(10,2) NOT NULL,
    "vatType" "VatType" NOT NULL DEFAULT 'NO_VAT',
    "vatRate" DECIMAL(5,2) NOT NULL,
    "note" TEXT,
    "status" "DocStatus" NOT NULL DEFAULT 'ACTIVE',
    "cancelNote" TEXT,
    "cancelledAt" TIMESTAMPTZ(3),
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "updatedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SalesQuotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesQuotationItem" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL,
    "showQty" DECIMAL(12,4) NOT NULL,
    "showUnitName" TEXT NOT NULL,
    "unitScale" DECIMAL(12,4) NOT NULL,
    "salePrice" DECIMAL(10,2) NOT NULL,
    "unitListPrice" DECIMAL(10,2) NOT NULL,
    "lineDiscount" DECIMAL(10,2) NOT NULL,
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "moreDetail" TEXT,
    "priceListId" TEXT,
    "pricePromotionId" TEXT,
    "priceSource" "SalePriceSource",

    CONSTRAINT "SalesQuotationItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalesQuotation_quotationNo_key" ON "SalesQuotation"("quotationNo");

-- CreateIndex
CREATE INDEX "SalesQuotation_customerId_status_quotationDate_idx" ON "SalesQuotation"("customerId", "status", "quotationDate");

-- CreateIndex
CREATE INDEX "SalesQuotation_quotationDate_status_idx" ON "SalesQuotation"("quotationDate", "status");

-- CreateIndex
CREATE INDEX "SalesQuotationItem_quotationId_lineNo_idx" ON "SalesQuotationItem"("quotationId", "lineNo");

-- CreateIndex
CREATE INDEX "SalesQuotationItem_productId_idx" ON "SalesQuotationItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_activeQuotationId_key" ON "Sale"("activeQuotationId");

-- CreateIndex
CREATE INDEX "Sale_quotationId_idx" ON "Sale"("quotationId");

-- AddForeignKey
ALTER TABLE "SalesQuotation" ADD CONSTRAINT "SalesQuotation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesQuotationItem" ADD CONSTRAINT "SalesQuotationItem_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "SalesQuotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesQuotationItem" ADD CONSTRAINT "SalesQuotationItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "SalesQuotation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_activeQuotationId_fkey" FOREIGN KEY ("activeQuotationId") REFERENCES "SalesQuotation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
