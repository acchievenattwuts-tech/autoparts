-- Add lineNo to 8 item tables. Pattern mirrors PurchaseItem.lineNo
-- (20260526_add_purchase_item_line_no). All new columns default to 0 so
-- existing rows are unaffected; downstream queries fall back to id ordering.

ALTER TABLE "SaleItem"               ADD COLUMN IF NOT EXISTS "lineNo" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CreditNoteItem"         ADD COLUMN IF NOT EXISTS "lineNo" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseReturnItem"     ADD COLUMN IF NOT EXISTS "lineNo" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AdjustmentItem"         ADD COLUMN IF NOT EXISTS "lineNo" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ExpenseItem"            ADD COLUMN IF NOT EXISTS "lineNo" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ReceiptItem"            ADD COLUMN IF NOT EXISTS "lineNo" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SupplierPaymentItem"    ADD COLUMN IF NOT EXISTS "lineNo" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DeliveryCommissionItem" ADD COLUMN IF NOT EXISTS "lineNo" INTEGER NOT NULL DEFAULT 0;

-- Drop single-column indexes that are being replaced by composite (parentId, lineNo).
DROP INDEX IF EXISTS "SaleItem_saleId_idx";
DROP INDEX IF EXISTS "ReceiptItem_receiptId_idx";
DROP INDEX IF EXISTS "SupplierPaymentItem_paymentId_idx";

-- Composite indexes (match Prisma naming so `prisma db push` reports in-sync).
CREATE INDEX IF NOT EXISTS "SaleItem_saleId_lineNo_idx"
  ON "SaleItem"("saleId", "lineNo");

CREATE INDEX IF NOT EXISTS "CreditNoteItem_creditNoteId_lineNo_idx"
  ON "CreditNoteItem"("creditNoteId", "lineNo");

CREATE INDEX IF NOT EXISTS "PurchaseReturnItem_purchaseReturnId_lineNo_idx"
  ON "PurchaseReturnItem"("purchaseReturnId", "lineNo");

CREATE INDEX IF NOT EXISTS "AdjustmentItem_adjustmentId_lineNo_idx"
  ON "AdjustmentItem"("adjustmentId", "lineNo");

CREATE INDEX IF NOT EXISTS "ExpenseItem_expenseId_lineNo_idx"
  ON "ExpenseItem"("expenseId", "lineNo");

CREATE INDEX IF NOT EXISTS "ReceiptItem_receiptId_lineNo_idx"
  ON "ReceiptItem"("receiptId", "lineNo");

CREATE INDEX IF NOT EXISTS "SupplierPaymentItem_paymentId_lineNo_idx"
  ON "SupplierPaymentItem"("paymentId", "lineNo");

CREATE INDEX IF NOT EXISTS "DeliveryCommissionItem_runId_lineNo_idx"
  ON "DeliveryCommissionItem"("runId", "lineNo");
