import { db, dbTx } from "@/lib/db";
import { safeWriteAuditLog } from "@/lib/audit-log";
import { AuditAction } from "@/lib/generated/prisma";
import {
  rebuildCreditNoteProfitFacts,
  rebuildExpenseProfitFacts,
  rebuildSaleProfitFacts,
  rebuildSupplierDebitProfitFacts,
} from "@/lib/profit-fact";

async function main() {
  const [sales, creditNotes, expenses, debits] = await Promise.all([
    db.sale.findMany({ select: { id: true }, orderBy: { saleDate: "asc" } }),
    db.creditNote.findMany({ select: { id: true }, orderBy: { cnDate: "asc" } }),
    db.expense.findMany({ select: { id: true }, orderBy: { expenseDate: "asc" } }),
    db.supplierDebitNote.findMany({ select: { id: true }, orderBy: { postingDate: "asc" } }),
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

  for (const debit of debits) {
    await dbTx(async (tx) => { await rebuildSupplierDebitProfitFacts(tx, debit.id); });
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
      supplierDebits: debits.length,
    },
  });

  console.log(
    `Backfilled fact_profit for ${sales.length} sales, ${creditNotes.length} credit notes, ${expenses.length} expenses, ${debits.length} supplier debit notes.`,
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
