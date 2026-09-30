-- Review round 4 (2026-09-30), approved by the owner (T3, T4). Safe to apply BEFORE deploying the code.
-- Apply with: npx prisma db execute --file prisma/migrations/20260930_review_round4/migration.sql
-- Then run indexes/01.sql, 02.sql, 03.sql one by one, in order (each outside a transaction).

-- T3: stock value left when on-hand reaches zero is recognized as a cost variance fact.
ALTER TYPE "ProfitSourceType" ADD VALUE IF NOT EXISTS 'STOCK_VALUE_RESIDUAL';

-- ก1: bell + Telegram alert whenever an admin overrides the month lock of a declared profit period.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PERIOD_LOCK_OVERRIDDEN';

-- R5-D / T1 / ก3: "ปรับยอด DN" adjustment documents reuse SupplierDebitNote with a link to the DN they adjust,
-- and a negative adjustment beyond the parent's outstanding balance settles as supplier credit or cash refund.
ALTER TABLE "SupplierDebitNote" ADD COLUMN IF NOT EXISTS "adjustsDebitNoteId" TEXT;
ALTER TABLE "SupplierDebitNote" ADD COLUMN IF NOT EXISTS "excessSettlementType" "PurchaseReturnSettlementType";
ALTER TABLE "SupplierDebitNote" ADD COLUMN IF NOT EXISTS "refundMethod" "PurchaseReturnRefundMethod";
ALTER TABLE "SupplierDebitNote" ADD COLUMN IF NOT EXISTS "cashBankAccountId" TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SupplierDebitNote_adjustsDebitNoteId_fkey') THEN
    ALTER TABLE "SupplierDebitNote" ADD CONSTRAINT "SupplierDebitNote_adjustsDebitNoteId_fkey"
      FOREIGN KEY ("adjustsDebitNoteId") REFERENCES "SupplierDebitNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SupplierDebitNote_cashBankAccountId_fkey') THEN
    ALTER TABLE "SupplierDebitNote" ADD CONSTRAINT "SupplierDebitNote_cashBankAccountId_fkey"
      FOREIGN KEY ("cashBankAccountId") REFERENCES "CashBankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TYPE "CashBankSourceType" ADD VALUE IF NOT EXISTS 'SUPPLIER_DEBIT_REFUND';
ALTER TYPE "DocumentPaymentDocType" ADD VALUE IF NOT EXISTS 'SUPPLIER_DEBIT_REFUND';

-- V5: tax invoice number/date on purchase-side documents (required by the app when vatType <> NO_VAT;
-- the date decides whether input VAT is recoverable, together with the shop's VAT registration date).
ALTER TABLE "Purchase" ADD COLUMN IF NOT EXISTS "taxInvoiceNo" TEXT;
ALTER TABLE "Purchase" ADD COLUMN IF NOT EXISTS "taxInvoiceDate" TIMESTAMPTZ(3);
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "taxInvoiceNo" TEXT;
ALTER TABLE "Expense" ADD COLUMN IF NOT EXISTS "taxInvoiceDate" TIMESTAMPTZ(3);
ALTER TABLE "PurchaseReturn" ADD COLUMN IF NOT EXISTS "taxInvoiceNo" TEXT;
ALTER TABLE "PurchaseReturn" ADD COLUMN IF NOT EXISTS "taxInvoiceDate" TIMESTAMPTZ(3);
