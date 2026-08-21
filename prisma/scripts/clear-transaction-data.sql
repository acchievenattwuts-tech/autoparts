-- ================================================================
-- clear-transaction-data.sql
-- ลบข้อมูล transaction ทั้งหมด — เก็บเฉพาะ Master data
--
-- ตาราง Master ที่เก็บไว้:
--   User, AppRole, Permission, AppRolePermission, LoginThrottle
--   Category, PartsBrand, CarBrand, CarModel
--   Supplier, Customer, ExpenseCode
--   CashBankAccount (reset openingBalance = 0)
--   LineRecipient, UserLineRecipient
--   SiteContent, product_search_documents (ลบแล้ว trigger rebuild ใหม่เมื่อเพิ่มสินค้า)
--
-- วิธีใช้: รันใน Supabase SQL Editor — ทำ snapshot backup ก่อนเสมอ
-- ================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────
-- STEP 1: Lot sub-rows
-- ────────────────────────────────────────────────────────────────
DELETE FROM "StockMovementLot";
DELETE FROM "PurchaseItemLot";
DELETE FROM "SaleItemLot";
DELETE FROM "PurchaseReturnItemLot";
DELETE FROM "CreditNoteItemLot";
DELETE FROM "WarrantyClaimLot";

-- ────────────────────────────────────────────────────────────────
-- STEP 2: Claim sub-tables
-- ────────────────────────────────────────────────────────────────
DELETE FROM "ClaimStockMovement";
DELETE FROM "ClaimStockBalance";

-- ────────────────────────────────────────────────────────────────
-- STEP 3: Delivery
-- ────────────────────────────────────────────────────────────────
DELETE FROM "DeliveryTracking";
DELETE FROM "DeliveryProof";
DELETE FROM "DeliveryCommissionItem";
DELETE FROM "DeliveryCommissionRun";

-- ────────────────────────────────────────────────────────────────
-- STEP 4: SupplierPaymentItem
-- (references Purchase, PurchaseReturn, SupplierAdvance — ต้องลบก่อนทั้งสาม)
-- ────────────────────────────────────────────────────────────────
DELETE FROM "DocumentPayment";
DELETE FROM "SupplierPaymentItem";

-- ────────────────────────────────────────────────────────────────
-- STEP 5: PurchaseReturn
-- (มี claimId → WarrantyClaim — ต้องลบก่อน WarrantyClaim)
-- ────────────────────────────────────────────────────────────────
DELETE FROM "PurchaseReturnItem";
DELETE FROM "PurchaseReturn";

-- ────────────────────────────────────────────────────────────────
-- STEP 6: Warranty chain
-- ────────────────────────────────────────────────────────────────
DELETE FROM "WarrantyClaim";
DELETE FROM "Warranty";

-- ────────────────────────────────────────────────────────────────
-- STEP 7: Receipt & Credit Note items
-- ────────────────────────────────────────────────────────────────
DELETE FROM "ReceiptItem";
DELETE FROM "CreditNoteItem";

-- ────────────────────────────────────────────────────────────────
-- STEP 8: CreditNote
-- (มี saleId → Sale — ต้องลบก่อน Sale)
-- ────────────────────────────────────────────────────────────────
DELETE FROM "CreditNote";

-- ────────────────────────────────────────────────────────────────
-- STEP 9: Sale
-- ────────────────────────────────────────────────────────────────
DELETE FROM "SaleItem";
DELETE FROM "Sale";

-- ────────────────────────────────────────────────────────────────
-- STEP 10: Purchase
-- ────────────────────────────────────────────────────────────────
DELETE FROM "PurchaseItem";
DELETE FROM "Purchase";

-- ────────────────────────────────────────────────────────────────
-- STEP 11: Receipt, Expense, Adjustment
-- ────────────────────────────────────────────────────────────────
DELETE FROM "Receipt";
DELETE FROM "ExpenseItem";
DELETE FROM "Expense";
DELETE FROM "AdjustmentItem";
DELETE FROM "Adjustment";

-- ────────────────────────────────────────────────────────────────
-- STEP 12: SupplierAdvance & SupplierPayment
-- (SupplierPaymentItem ลบไปแล้วใน STEP 4)
-- ────────────────────────────────────────────────────────────────
DELETE FROM "CustomerAdvanceRefund";
DELETE FROM "SupplierAdvanceRefund";
DELETE FROM "CustomerAdvance";
DELETE FROM "SupplierAdvance";
DELETE FROM "SupplierPayment";

-- ────────────────────────────────────────────────────────────────
-- STEP 13: Cash/Bank movements
-- ────────────────────────────────────────────────────────────────
DELETE FROM "CashBankMovement";
DELETE FROM "CashBankTransfer";
DELETE FROM "CashBankAdjustment";

-- ────────────────────────────────────────────────────────────────
-- STEP 14: Stock ledger
-- ────────────────────────────────────────────────────────────────
DELETE FROM "StockCard";
DELETE FROM "BalanceForward";
DELETE FROM "ProductLot";
DELETE FROM "LotBalance";

-- ────────────────────────────────────────────────────────────────
-- STEP 15: Analytics / Logs
-- ────────────────────────────────────────────────────────────────
DELETE FROM "FactProfit";
DELETE FROM "AuditLog";
DELETE FROM "LineDailySummaryDispatch";
DELETE FROM "StorefrontVisitDaily";

-- ────────────────────────────────────────────────────────────────
-- STEP 16: Content
-- (ContentAuditLog, ContentScheduledJob, ContentApproval cascade จาก ContentPost
--  แต่ลบ explicit เพื่อความปลอดภัย)
-- ────────────────────────────────────────────────────────────────
DELETE FROM "ContentAuditLog";
DELETE FROM "ContentScheduledJob";
DELETE FROM "ContentApproval";
DELETE FROM "ContentPost";

-- ────────────────────────────────────────────────────────────────
-- STEP 17: Product
-- (ProductUnit, ProductAlias, ProductCarModel cascade อัตโนมัติ)
-- (product_search_documents ลบก่อน Product เพื่อป้องกัน trigger conflict)
-- ────────────────────────────────────────────────────────────────
DELETE FROM "product_search_documents";
DELETE FROM "Product";

-- ────────────────────────────────────────────────────────────────
-- STEP 18: Reset CashBankAccount — ยอดเงินเริ่มต้นทุกบัญชี = 0
-- ────────────────────────────────────────────────────────────────
UPDATE "CashBankAccount" SET "openingBalance" = 0;

-- ────────────────────────────────────────────────────────────────
-- STEP 19: Reset LINE Daily Summary state ใน SiteContent
-- ────────────────────────────────────────────────────────────────
DELETE FROM "SiteContent"
WHERE key IN (
  'line_daily_summary_last_sent_day_key',
  'line_daily_summary_last_sent_at'
);

COMMIT;
