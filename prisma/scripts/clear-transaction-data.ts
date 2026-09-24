/**
 * clear-transaction-data.ts
 * ลบข้อมูล transaction ทั้งหมด — เก็บเฉพาะ Master data
 *
 * TEST DATABASES ONLY. Refuses to run against the production Supabase project,
 * and against any other remote database unless it is named explicitly
 * (see lib/destructive-db-script-guard.ts).
 *
 * AuditLog is never deleted — it is append-only (.rules §9).
 *
 * Usage:
 *   npx tsx prisma/scripts/clear-transaction-data.ts             # dry run: print row counts only
 *   npx tsx prisma/scripts/clear-transaction-data.ts --execute   # actually delete
 *
 * Remote disposable database: set ALLOW_DESTRUCTIVE_DB_SCRIPT to the exact
 * target string the refusal message prints.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../../lib/generated/prisma";
import {
  DESTRUCTIVE_DB_OVERRIDE_ENV,
  checkDestructiveDbTarget,
} from "../../lib/destructive-db-script-guard";

const TRANSACTION_TIMEOUT_MS = 120_000;

/** A table (or one-off statement) the wipe touches: count first, then clear. */
type WipeTarget = {
  count: () => Promise<number>;
  deleteMany: () => Promise<{ count: number }>;
};

type Step = (label: string, target: WipeTarget) => Promise<void>;

const makeStep = (execute: boolean): Step => async (label, target) => {
  process.stdout.write(`  ${label}...`);
  if (!execute) {
    console.log(` ${await target.count()} row(s)`);
    return;
  }
  const { count } = await target.deleteMany();
  console.log(` done (${count} row(s))`);
};

async function main(): Promise<void> {
  const execute = process.argv.includes("--execute");
  const check = checkDestructiveDbTarget(
    process.env.DATABASE_URL,
    process.env[DESTRUCTIVE_DB_OVERRIDE_ENV],
  );
  if (!check.allowed) {
    console.error(`\nREFUSED — ${check.reason}\nNothing was read or deleted.\n`);
    process.exitCode = 1;
    return;
  }

  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 1 }),
  });
  try {
    await run(db, execute, check.target);
  } finally {
    await db.$disconnect();
  }
}

async function run(db: PrismaClient, execute: boolean, target: string): Promise<void> {
  console.log(`\n🗑️  Clear Transaction Data — ${execute ? "EXECUTE" : "DRY RUN"}`);
  console.log(`Target: ${target}\n`);
  console.log("Master data ที่เก็บไว้: User, AppRole, Permission, Category,");
  console.log("PartsBrand, CarBrand, CarModel, Supplier, Customer, ExpenseCode,",
  );
  console.log("CashBankAccount, LineRecipient, SiteContent\n");
  console.log("─".repeat(55));

  if (!execute) {
    await wipeTransactionData(db, makeStep(false));
    console.log("\n" + "─".repeat(55));
    console.log("DRY RUN — nothing was deleted. Re-run with --execute to delete the rows counted above.\n");
    return;
  }

  await db.$transaction((tx) => wipeTransactionData(tx, makeStep(true)), {
    timeout: TRANSACTION_TIMEOUT_MS,
  });

  console.log("\n" + "─".repeat(55));
  console.log("✅ สำเร็จ — ข้อมูล transaction ถูกลบทั้งหมด\n");
}

async function wipeTransactionData(client: Prisma.TransactionClient, step: Step): Promise<void> {
  // ── STEP 1: Lot sub-rows ────────────────────────────────
  console.log("\nSTEP 1: Lot sub-rows");
  await step("StockMovementLot", client.stockMovementLot);
  await step("PurchaseItemLot", client.purchaseItemLot);
  await step("SaleItemLot", client.saleItemLot);
  await step("PurchaseReturnItemLot", client.purchaseReturnItemLot);
  await step("CreditNoteItemLot", client.creditNoteItemLot);
  await step("WarrantyClaimLot", client.warrantyClaimLot);

  // ── STEP 2: Claim sub-tables ────────────────────────────
  console.log("\nSTEP 2: Claim sub-tables");
  await step("ClaimStockMovement", client.claimStockMovement);
  await step("ClaimStockBalance", client.claimStockBalance);

  // ── STEP 3: Delivery ────────────────────────────────────
  console.log("\nSTEP 3: Delivery");
  await step("DeliveryTracking", client.deliveryTracking);
  await step("DeliveryProof", client.deliveryProof);
  await step("DeliveryCommissionItem", client.deliveryCommissionItem);
  await step("DeliveryCommissionRun", client.deliveryCommissionRun);

  // ── STEP 4: SupplierPaymentItem ─────────────────────────
  console.log("\nSTEP 4: SupplierPaymentItem");
  await step("DocumentPayment", client.documentPayment);
  await step("SupplierPaymentItem", client.supplierPaymentItem);

  // ── STEP 5: PurchaseReturn ──────────────────────────────
  console.log("\nSTEP 5: PurchaseReturn (ก่อน WarrantyClaim)");
  await step("PurchaseReturnItem", client.purchaseReturnItem);
  await step("PurchaseReturn", client.purchaseReturn);

  // ── STEP 6: Warranty chain ──────────────────────────────
  console.log("\nSTEP 6: Warranty chain");
  await step("WarrantyClaim", client.warrantyClaim);
  await step("Warranty", client.warranty);

  // ── STEP 7: Receipt & Credit Note items ─────────────────
  console.log("\nSTEP 7: Receipt & Credit Note items");
  await step("ReceiptItem", client.receiptItem);
  await step("CreditNoteItem", client.creditNoteItem);

  // ── STEP 8: CreditNote (ก่อน Sale) ─────────────────────
  console.log("\nSTEP 8: CreditNote");
  await step("CreditNote", client.creditNote);

  // ── STEP 9: Sale ────────────────────────────────────────
  console.log("\nSTEP 9: Sale");
  await step("SaleItem", client.saleItem);
  await step("Sale", client.sale);

  // ── STEP 10: Purchase ───────────────────────────────────
  console.log("\nSTEP 10: Purchase");
  await step("PurchaseItem", client.purchaseItem);
  await step("Purchase", client.purchase);

  // ── STEP 11: Receipt, Expense, Adjustment ───────────────
  console.log("\nSTEP 11: Receipt, Expense, Adjustment");
  await step("Receipt", client.receipt);
  await step("ExpenseItem", client.expenseItem);
  await step("Expense", client.expense);
  await step("AdjustmentItem", client.adjustmentItem);
  await step("Adjustment", client.adjustment);

  // ── STEP 12: SupplierAdvance & SupplierPayment ──────────
  console.log("\nSTEP 12: SupplierAdvance & SupplierPayment");
  await step("CustomerAdvanceRefund", client.customerAdvanceRefund);
  await step("SupplierAdvanceRefund", client.supplierAdvanceRefund);
  await step("CustomerAdvance", client.customerAdvance);
  await step("SupplierAdvance", client.supplierAdvance);
  await step("SupplierPayment", client.supplierPayment);

  // ── STEP 13: Cash/Bank movements ────────────────────────
  console.log("\nSTEP 13: Cash/Bank movements");
  await step("CashBankMovement", client.cashBankMovement);
  await step("CashBankTransfer", client.cashBankTransfer);
  await step("CashBankAdjustment", client.cashBankAdjustment);

  // ── STEP 14: Stock ledger ───────────────────────────────
  console.log("\nSTEP 14: Stock ledger");
  await step("StockCard", client.stockCard);
  await step("BalanceForward", client.balanceForward);
  await step("ProductLot", client.productLot);
  await step("LotBalance", client.lotBalance);

  // ── STEP 15: Analytics / Logs ───────────────────────────
  console.log("\nSTEP 15: Analytics / Logs");
  await step("FactProfit", client.factProfit);
  // AuditLog is append-only (.rules §9) — deliberately NOT cleared here.
  await step("LineDailySummaryDispatch", client.lineDailySummaryDispatch);
  await step("StorefrontVisitDaily", client.storefrontVisitDaily);

  // ── STEP 16: Content ────────────────────────────────────
  console.log("\nSTEP 16: Content");
  await step("ContentAuditLog", client.contentAuditLog);
  await step("ContentScheduledJob", client.contentScheduledJob);
  await step("ContentApproval", client.contentApproval);
  await step("ContentPost", client.contentPost);

  // ── STEP 17: Product ────────────────────────────────────
  console.log("\nSTEP 17: Product");
  await step("product_search_documents", {
    count: async () => {
      const [row] = await client.$queryRaw<{ count: number }[]>`
        SELECT COUNT(*)::int AS count FROM "product_search_documents"`;
      return row?.count ?? 0;
    },
    deleteMany: async () => ({
      count: await client.$executeRaw`DELETE FROM "product_search_documents"`,
    }),
  });
  await step("Product (cascade: Unit, Alias, CarModel)", client.product);

  // ── STEP 18: Reset CashBankAccount ──────────────────────
  console.log("\nSTEP 18: Reset CashBankAccount.openingBalance = 0");
  await step("CashBankAccount reset", {
    count: () => client.cashBankAccount.count({ where: { openingBalance: { not: 0 } } }),
    deleteMany: () => client.cashBankAccount.updateMany({ data: { openingBalance: 0 } }),
  });

  // ── STEP 19: Reset LINE Daily Summary state ─────────────
  console.log("\nSTEP 19: Reset LINE Daily Summary state");
  const lineSummaryKeys = {
    key: { in: ["line_daily_summary_last_sent_day_key", "line_daily_summary_last_sent_at"] },
  };
  await step("SiteContent (LINE keys)", {
    count: () => client.siteContent.count({ where: lineSummaryKeys }),
    deleteMany: () => client.siteContent.deleteMany({ where: lineSummaryKeys }),
  });
}

main().catch((error) => {
  console.error("\n❌ ERROR — transaction rolled back, ไม่มีข้อมูลถูกลบ:");
  console.error(error);
  process.exitCode = 1;
});
