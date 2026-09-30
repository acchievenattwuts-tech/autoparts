-- Review round 3 (2026-09-30), approved by the owner (R1 = A, R9).
-- Apply with: npx prisma db execute --file prisma/migrations/20260930_review_round3/migration.sql
-- Then run indexes/*.sql one by one (outside a transaction).

-- R1: a cancelled Supplier DN must not lock its purchase lines forever.
-- DN lines keep their product/unit/price snapshot; the link is cleared when the purchase line is deleted.
ALTER TABLE "SupplierDebitNoteItem" ALTER COLUMN "purchaseItemId" DROP NOT NULL;

ALTER TABLE "SupplierDebitNoteItem" DROP CONSTRAINT IF EXISTS "SupplierDebitNoteItem_purchaseItemId_fkey";
ALTER TABLE "SupplierDebitNoteItem" ADD CONSTRAINT "SupplierDebitNoteItem_purchaseItemId_fkey"
  FOREIGN KEY ("purchaseItemId") REFERENCES "PurchaseItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- C2: bell + Telegram alert when a LINE delivery card fails permanently.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'LINE_DELIVERY_FAILED';
