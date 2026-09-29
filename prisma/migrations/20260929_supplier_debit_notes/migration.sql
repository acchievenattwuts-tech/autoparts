-- Approved additive Supplier DN Option B schema.
-- Run this file first; run each indexes/*.sql separately outside a transaction.
-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "SupplierDebitAmountMode" AS ENUM ('PER_UNIT', 'TOTAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterEnum
ALTER TYPE "StockCardSource" ADD VALUE IF NOT EXISTS 'SUPPLIER_DEBIT';

-- AlterEnum
ALTER TYPE "ProfitSourceType" ADD VALUE IF NOT EXISTS 'PURCHASE_COST_VARIANCE';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'SUPPLIER_DEBIT_NOTE';

-- AlterTable
ALTER TABLE "StockCard" ADD COLUMN IF NOT EXISTS "costVariance" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "valuationEpoch" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "valueAdjustment" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SupplierPaymentItem" ADD COLUMN IF NOT EXISTS "debitNoteId" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "SupplierDebitNote" (
    "id" TEXT NOT NULL,
    "debitNo" TEXT NOT NULL,
    "supplierReferenceNo" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "debitDate" TIMESTAMPTZ(3) NOT NULL,
    "receivedDate" TIMESTAMPTZ(3) NOT NULL,
    "postingDate" TIMESTAMPTZ(3) NOT NULL,
    "dueDate" TIMESTAMPTZ(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "vatType" "VatType" NOT NULL,
    "vatRate" DECIMAL(5,2) NOT NULL,
    "vatRecoverable" BOOLEAN NOT NULL DEFAULT true,
    "subtotalAmount" DECIMAL(10,2) NOT NULL,
    "vatAmount" DECIMAL(10,2) NOT NULL,
    "netAmount" DECIMAL(10,2) NOT NULL,
    "inventoryAmount" DECIMAL(10,2) NOT NULL,
    "varianceAmount" DECIMAL(10,2) NOT NULL,
    "amountRemain" DECIMAL(10,2) NOT NULL,
    "status" "DocStatus" NOT NULL DEFAULT 'ACTIVE',
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelNote" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SupplierDebitNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SupplierDebitNoteItem" (
    "id" TEXT NOT NULL,
    "debitNoteId" TEXT NOT NULL,
    "purchaseItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "amountMode" "SupplierDebitAmountMode" NOT NULL,
    "increaseAmount" DECIMAL(10,2) NOT NULL,
    "affectedQuantity" DECIMAL(12,4) NOT NULL,
    "affectedBaseQuantity" DECIMAL(12,4) NOT NULL,
    "showUnitName" TEXT NOT NULL,
    "unitScale" DECIMAL(12,4) NOT NULL,
    "originalUnitPrice" DECIMAL(10,2) NOT NULL,
    "subtotalAmount" DECIMAL(10,2) NOT NULL,
    "vatAmount" DECIMAL(10,2) NOT NULL,
    "netAmount" DECIMAL(10,2) NOT NULL,
    "costAdjustmentAmount" DECIMAL(10,2) NOT NULL,
    "eligibleBaseQuantity" DECIMAL(12,4) NOT NULL,
    "inventoryAmount" DECIMAL(10,2) NOT NULL,
    "varianceAmount" DECIMAL(10,2) NOT NULL,
    "stockBefore" DECIMAL(12,4) NOT NULL,
    "avgCostBefore" DECIMAL(10,4) NOT NULL,
    "avgCostAfter" DECIMAL(10,4) NOT NULL,
    "stockCardId" TEXT,

    CONSTRAINT "SupplierDebitNoteItem_pkey" PRIMARY KEY ("id")
);















-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SupplierPaymentItem_debitNoteId_fkey') THEN
    ALTER TABLE "SupplierPaymentItem" ADD CONSTRAINT "SupplierPaymentItem_debitNoteId_fkey" FOREIGN KEY ("debitNoteId") REFERENCES "SupplierDebitNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SupplierDebitNote_purchaseId_fkey') THEN
    ALTER TABLE "SupplierDebitNote" ADD CONSTRAINT "SupplierDebitNote_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SupplierDebitNote_supplierId_fkey') THEN
    ALTER TABLE "SupplierDebitNote" ADD CONSTRAINT "SupplierDebitNote_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SupplierDebitNote_userId_fkey') THEN
    ALTER TABLE "SupplierDebitNote" ADD CONSTRAINT "SupplierDebitNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SupplierDebitNoteItem_debitNoteId_fkey') THEN
    ALTER TABLE "SupplierDebitNoteItem" ADD CONSTRAINT "SupplierDebitNoteItem_debitNoteId_fkey" FOREIGN KEY ("debitNoteId") REFERENCES "SupplierDebitNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SupplierDebitNoteItem_purchaseItemId_fkey') THEN
    ALTER TABLE "SupplierDebitNoteItem" ADD CONSTRAINT "SupplierDebitNoteItem_purchaseItemId_fkey" FOREIGN KEY ("purchaseItemId") REFERENCES "PurchaseItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SupplierDebitNoteItem_productId_fkey') THEN
    ALTER TABLE "SupplierDebitNoteItem" ADD CONSTRAINT "SupplierDebitNoteItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Financial DN tables follow the repo's backend-only Supabase access policy.
-- The application database role retains owner/service access as existing financial tables.
ALTER TABLE public."SupplierDebitNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SupplierDebitNoteItem" ENABLE ROW LEVEL SECURITY;
