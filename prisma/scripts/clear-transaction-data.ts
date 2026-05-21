/**
 * clear-transaction-data.ts
 * ลบข้อมูล transaction ทั้งหมด — เก็บเฉพาะ Master data
 *
 * Usage:
 *   npx tsx prisma/scripts/clear-transaction-data.ts
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../lib/generated/prisma";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
  max: 1,
});
const db = new PrismaClient({ adapter });

async function step(label: string, fn: () => Promise<unknown>) {
  process.stdout.write(`  ${label}...`);
  await fn();
  console.log(" done");
}

async function main() {
  console.log("\n🗑️  Clear Transaction Data — Production\n");
  console.log("Master data ที่เก็บไว้: User, AppRole, Permission, Category,");
  console.log("PartsBrand, CarBrand, CarModel, Supplier, Customer, ExpenseCode,");
  console.log("CashBankAccount, LineRecipient, SiteContent\n");
  console.log("─".repeat(55));

  await db.$transaction(
    async (tx) => {
      // ── STEP 1: Lot sub-rows ────────────────────────────────
      console.log("\nSTEP 1: Lot sub-rows");
      await step("StockMovementLot", () => tx.stockMovementLot.deleteMany());
      await step("PurchaseItemLot", () => tx.purchaseItemLot.deleteMany());
      await step("SaleItemLot", () => tx.saleItemLot.deleteMany());
      await step("PurchaseReturnItemLot", () => tx.purchaseReturnItemLot.deleteMany());
      await step("CreditNoteItemLot", () => tx.creditNoteItemLot.deleteMany());
      await step("WarrantyClaimLot", () => tx.warrantyClaimLot.deleteMany());

      // ── STEP 2: Claim sub-tables ────────────────────────────
      console.log("\nSTEP 2: Claim sub-tables");
      await step("ClaimStockMovement", () => tx.claimStockMovement.deleteMany());
      await step("ClaimStockBalance", () => tx.claimStockBalance.deleteMany());

      // ── STEP 3: Delivery ────────────────────────────────────
      console.log("\nSTEP 3: Delivery");
      await step("DeliveryTracking", () => tx.deliveryTracking.deleteMany());
      await step("DeliveryProof", () => tx.deliveryProof.deleteMany());
      await step("DeliveryCommissionItem", () => tx.deliveryCommissionItem.deleteMany());
      await step("DeliveryCommissionRun", () => tx.deliveryCommissionRun.deleteMany());

      // ── STEP 4: SupplierPaymentItem ─────────────────────────
      console.log("\nSTEP 4: SupplierPaymentItem");
      await step("SupplierPaymentItem", () => tx.supplierPaymentItem.deleteMany());

      // ── STEP 5: PurchaseReturn ──────────────────────────────
      console.log("\nSTEP 5: PurchaseReturn (ก่อน WarrantyClaim)");
      await step("PurchaseReturnItem", () => tx.purchaseReturnItem.deleteMany());
      await step("PurchaseReturn", () => tx.purchaseReturn.deleteMany());

      // ── STEP 6: Warranty chain ──────────────────────────────
      console.log("\nSTEP 6: Warranty chain");
      await step("WarrantyClaim", () => tx.warrantyClaim.deleteMany());
      await step("Warranty", () => tx.warranty.deleteMany());

      // ── STEP 7: Receipt & Credit Note items ─────────────────
      console.log("\nSTEP 7: Receipt & Credit Note items");
      await step("ReceiptItem", () => tx.receiptItem.deleteMany());
      await step("CreditNoteItem", () => tx.creditNoteItem.deleteMany());

      // ── STEP 8: CreditNote (ก่อน Sale) ─────────────────────
      console.log("\nSTEP 8: CreditNote");
      await step("CreditNote", () => tx.creditNote.deleteMany());

      // ── STEP 9: Sale ────────────────────────────────────────
      console.log("\nSTEP 9: Sale");
      await step("SaleItem", () => tx.saleItem.deleteMany());
      await step("Sale", () => tx.sale.deleteMany());

      // ── STEP 10: Purchase ───────────────────────────────────
      console.log("\nSTEP 10: Purchase");
      await step("PurchaseItem", () => tx.purchaseItem.deleteMany());
      await step("Purchase", () => tx.purchase.deleteMany());

      // ── STEP 11: Receipt, Expense, Adjustment ───────────────
      console.log("\nSTEP 11: Receipt, Expense, Adjustment");
      await step("Receipt", () => tx.receipt.deleteMany());
      await step("ExpenseItem", () => tx.expenseItem.deleteMany());
      await step("Expense", () => tx.expense.deleteMany());
      await step("AdjustmentItem", () => tx.adjustmentItem.deleteMany());
      await step("Adjustment", () => tx.adjustment.deleteMany());

      // ── STEP 12: SupplierAdvance & SupplierPayment ──────────
      console.log("\nSTEP 12: SupplierAdvance & SupplierPayment");
      await step("SupplierAdvance", () => tx.supplierAdvance.deleteMany());
      await step("SupplierPayment", () => tx.supplierPayment.deleteMany());

      // ── STEP 13: Cash/Bank movements ────────────────────────
      console.log("\nSTEP 13: Cash/Bank movements");
      await step("CashBankMovement", () => tx.cashBankMovement.deleteMany());
      await step("CashBankTransfer", () => tx.cashBankTransfer.deleteMany());
      await step("CashBankAdjustment", () => tx.cashBankAdjustment.deleteMany());

      // ── STEP 14: Stock ledger ───────────────────────────────
      console.log("\nSTEP 14: Stock ledger");
      await step("StockCard", () => tx.stockCard.deleteMany());
      await step("BalanceForward", () => tx.balanceForward.deleteMany());
      await step("ProductLot", () => tx.productLot.deleteMany());
      await step("LotBalance", () => tx.lotBalance.deleteMany());

      // ── STEP 15: Analytics / Logs ───────────────────────────
      console.log("\nSTEP 15: Analytics / Logs");
      await step("FactProfit", () => tx.factProfit.deleteMany());
      await step("AuditLog", () => tx.auditLog.deleteMany());
      await step("LineDailySummaryDispatch", () => tx.lineDailySummaryDispatch.deleteMany());
      await step("StorefrontVisitDaily", () => tx.storefrontVisitDaily.deleteMany());

      // ── STEP 16: Content ────────────────────────────────────
      console.log("\nSTEP 16: Content");
      await step("ContentAuditLog", () => tx.contentAuditLog.deleteMany());
      await step("ContentScheduledJob", () => tx.contentScheduledJob.deleteMany());
      await step("ContentApproval", () => tx.contentApproval.deleteMany());
      await step("ContentPost", () => tx.contentPost.deleteMany());

      // ── STEP 17: Product ────────────────────────────────────
      console.log("\nSTEP 17: Product");
      await step("product_search_documents", () =>
        tx.$executeRawUnsafe(`DELETE FROM "product_search_documents"`)
      );
      await step("Product (cascade: Unit, Alias, CarModel)", () => tx.product.deleteMany());

      // ── STEP 18: Reset CashBankAccount ──────────────────────
      console.log("\nSTEP 18: Reset CashBankAccount.openingBalance = 0");
      await step("CashBankAccount reset", () =>
        tx.cashBankAccount.updateMany({ data: { openingBalance: 0 } })
      );

      // ── STEP 19: Reset LINE Daily Summary state ─────────────
      console.log("\nSTEP 19: Reset LINE Daily Summary state");
      await step("SiteContent (LINE keys)", () =>
        tx.siteContent.deleteMany({
          where: {
            key: {
              in: ["line_daily_summary_last_sent_day_key", "line_daily_summary_last_sent_at"],
            },
          },
        })
      );
    },
    { timeout: 120_000 }
  );

  console.log("\n" + "─".repeat(55));
  console.log("✅ สำเร็จ — ข้อมูล transaction ถูกลบทั้งหมด\n");
}

main()
  .catch((error) => {
    console.error("\n❌ ERROR — transaction rolled back, ไม่มีข้อมูลถูกลบ:");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
