import { db, dbTx } from "@/lib/db";
import { safeWriteAuditLog } from "@/lib/audit-log";
import { AuditAction } from "@/lib/generated/prisma";
import {
  rebuildCreditNoteProfitFacts,
  rebuildExpenseProfitFacts,
  rebuildMarketplaceSettlementProfitFacts,
  rebuildPurchaseAllowanceProfitFacts,
  rebuildSaleProfitFacts,
  rebuildStockValueResidualFactsForProducts,
  rebuildSupplierDebitProfitFacts,
} from "@/lib/profit-fact";
import { STOCK_VALUE_RESIDUAL_START_DATE } from "@/lib/stock-card";
import { valueOnlyStockSources } from "@/lib/stock-value-only-source";
import { parseDateOnlyToStartOfDay } from "@/lib/th-date";

/**
 * T3: products with a stock value written off (costVariance of a StockCard row that is not value-only — DN or
 * ลดราคาซื้อ — from the go-live date) or an active
 * STOCK_VALUE_RESIDUAL fact. One-off scan by date; StockCard has no date-only index, acceptable for a backfill.
 */
async function listStockValueResidualProducts(since: Date): Promise<string[]> {
  const rows = await db.stockCard.findMany({ where: { docDate: { gte: since }, source: { notIn: valueOnlyStockSources() }, costVariance: { not: 0 } },
    select: { productId: true }, distinct: ["productId"] });
  const facts = await db.factProfit.findMany({ where: { sourceType: "STOCK_VALUE_RESIDUAL", isActive: true },
    select: { sourceId: true }, distinct: ["sourceId"] });
  return [...new Set([...rows.map((row) => row.productId), ...facts.map((fact) => fact.sourceId)])];
}

async function main(): Promise<void> {
  // A marketplace fee expense is owned by its settlement: the settlement writes that
  // expense's facts on each sale date (or on the settlement date for a sale month that was
  // already distributed when the settlement was recorded — P2 = B, decided from stored
  // timestamps, so this backfill reproduces the same dates). rebuildExpenseProfitFacts() would move the fee
  // back to the expense date, so those expenses are rebuilt through their settlement.
  const [sales, creditNotes, expenses, settlementOwnedExpenses, settlements, debits, allowanceReturns] = await Promise.all([
    db.sale.findMany({ select: { id: true }, orderBy: { saleDate: "asc" } }),
    db.creditNote.findMany({ select: { id: true }, orderBy: { cnDate: "asc" } }),
    db.expense.findMany({
      where: { marketplaceSettlement: { is: null } },
      select: { id: true },
      orderBy: { expenseDate: "asc" },
    }),
    db.expense.count({ where: { marketplaceSettlement: { isNot: null } } }),
    db.marketplaceSettlement.findMany({ select: { id: true }, orderBy: { settlementDate: "asc" } }),
    db.supplierDebitNote.findMany({ select: { id: true }, orderBy: { postingDate: "asc" } }),
    // V8: DISCOUNT/OTHER purchase returns carry ลดราคาซื้อ variance facts (rebuilt from their stored rows).
    db.purchaseReturn.findMany({ where: { type: { in: ["DISCOUNT", "OTHER"] } }, select: { id: true }, orderBy: { createdAt: "asc" } }),
  ]);

  for (const sale of sales) {
    await dbTx(async (tx) => {
      await rebuildSaleProfitFacts(tx, sale.id);
    });
  }

  for (const creditNote of creditNotes) {
    await dbTx(async (tx) => {
      await rebuildCreditNoteProfitFacts(tx, creditNote.id);
    });
  }

  for (const expense of expenses) {
    await dbTx(async (tx) => {
      await rebuildExpenseProfitFacts(tx, expense.id);
    });
  }

  for (const settlement of settlements) {
    await dbTx(async (tx) => {
      await rebuildMarketplaceSettlementProfitFacts(tx, settlement.id);
    });
  }

  for (const debit of debits) {
    await dbTx(async (tx) => { await rebuildSupplierDebitProfitFacts(tx, debit.id); });
  }

  for (const purchaseReturn of allowanceReturns) {
    await dbTx(async (tx) => { await rebuildPurchaseAllowanceProfitFacts(tx, purchaseReturn.id); });
  }

  const residualSince = parseDateOnlyToStartOfDay(STOCK_VALUE_RESIDUAL_START_DATE);
  const residualProducts = await listStockValueResidualProducts(residualSince);
  for (const productId of residualProducts) {
    await dbTx(async (tx) => { await rebuildStockValueResidualFactsForProducts(tx, [productId], residualSince); });
  }

  await safeWriteAuditLog({
    userName: "SYSTEM",
    userRole: "SYSTEM",
    action: AuditAction.RECALCULATE,
    entityType: "FactProfit",
    entityId: "backfill",
    entityRef: "backfill-fact-profit",
    meta: {
      script: "backfill-fact-profit",
      sales: sales.length,
      creditNotes: creditNotes.length,
      expenses: expenses.length,
      settlementOwnedExpensesSkipped: settlementOwnedExpenses,
      marketplaceSettlements: settlements.length,
      supplierDebits: debits.length,
      purchaseAllowanceReturns: allowanceReturns.length,
      stockValueResidualProducts: residualProducts.length,
    },
  });

  console.log(
    `Backfilled fact_profit for ${sales.length} sales, ${creditNotes.length} credit notes, ${expenses.length} expenses (${settlementOwnedExpenses} settlement-owned fee expenses skipped), ${settlements.length} marketplace settlements, ${debits.length} supplier debit notes, ${allowanceReturns.length} discount/other purchase returns, ${residualProducts.length} products with stock value residuals.`,
  );
}

main()
  .catch((error) => {
    console.error("[backfill-fact-profit]", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
