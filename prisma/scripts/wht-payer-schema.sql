-- Additive WHT phase 2 (ฝั่งจ่าย — เราหักผู้รับเงินแล้วออกหนังสือรับรอง 50 ทวิ) schema only.
-- จงใจไม่ใช้ `prisma db push` ด้วยเหตุผลเดียวกับ wht-schema.sql:
-- diff จะ drop `product_search_documents.trgm_text` (generated column ของ setup-search-v2.ts)
-- พร้อม index ค้นหาอีก 5 ตัว — ดู PLAN.md
BEGIN;
SET LOCAL lock_timeout = '5s';

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "supplierId" TEXT,
ADD COLUMN     "whtAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SupplierPayment" ADD COLUMN     "whtAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Expense_supplierId_expenseDate_idx" ON "Expense"("supplierId", "expenseDate" DESC);

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
