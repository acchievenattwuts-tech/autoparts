/** Read-only audit. Does not rebuild facts or amend source documents.
 * Run: npx tsx --env-file=.env.local scripts/audit-sale-profit-vat.ts
 */
import { db } from "@/lib/db";
import type { Prisma, ProfitSourceType } from "@/lib/generated/prisma";
import { isValueOnlyCreditNoteType } from "@/lib/profit-fact";
import {
  allocateMoneyByWeights,
  allocateSaleProfitRevenue,
  type ProfitRevenueAllocation,
} from "@/lib/sale-profit-revenue";
import { calcItemSubtotal, calcVat } from "@/lib/vat";
import { getThailandMonthKey, parseDateOnlyToStartOfDay } from "@/lib/th-date";
import { STOCK_VALUE_RESIDUAL_START_DATE } from "@/lib/stock-card";

const BATCH_SIZE = 100;
const cents = (amount: number): number => Math.round(amount * 100);
type AuditPeriod = { count: number; revenueDeltaCents: number; netProfitDeltaCents: number };
type PeriodDeltas = { mismatched: number; periods: Record<string, AuditPeriod> };
type AuditResult = PeriodDeltas & {
  scanned: number; missingFacts: number; invalidHeaders: number;
  staleLineSubtotals: number; salesWithAllocationDifferences: number;
};
type CreditNoteAuditResult = PeriodDeltas & {
  scanned: number; missingFacts: number; staleLineSubtotals: number; wrongSignFactLines: number;
  creditNotesWithAllocationDifferences: number;
  /** DISCOUNT/OTHER fact lines must reduce revenue only: quantity 0 and cost 0. */
  valueOnlyFactLinesWithQuantityOrCost: number;
};
type CancelledAudit = { scanned: number; withActiveFacts: number };
type FactLine = { sourceLineId: string | null; salesAmountExVat: Prisma.Decimal; salesAmountIncVat: Prisma.Decimal };

function linesDifferFromExpected(expectedLines: Map<string, ProfitRevenueAllocation>, lines: FactLine[]): boolean {
  return lines.length !== expectedLines.size || lines.some((line) => {
    const expected = expectedLines.get(line.sourceLineId ?? "");
    return !expected || cents(expected.exVat) !== cents(Number(line.salesAmountExVat)) ||
      cents(expected.incVat) !== cents(Number(line.salesAmountIncVat));
  }) || new Set(lines.map((line) => line.sourceLineId)).size !== expectedLines.size;
}

function hasAllocationDifference(saleId: string, itemIds: string[],
  allocation: ReturnType<typeof allocateSaleProfitRevenue>, lines: FactLine[],
): boolean {
  const expectedLines = new Map(itemIds.map((id, index) => [id, allocation.items[index]]));
  if (allocation.shipping.incVat > 0) expectedLines.set(`${saleId}:shipping`, allocation.shipping);
  return linesDifferFromExpected(expectedLines, lines);
}

/** Expected SALE_RETURN lines under the current satang allocator (negative revenue). */
function hasReturnAllocationDifference(creditNote: { subtotalAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal; items: { id: string; amount: Prisma.Decimal }[] }, lines: FactLine[],
): boolean {
  const weights = creditNote.items.map((item) => Number(item.amount));
  const subtotalCents = cents(Number(creditNote.subtotalAmount));
  const bases = allocateMoneyByWeights(subtotalCents / 100, weights);
  const taxes = allocateMoneyByWeights((cents(Number(creditNote.totalAmount)) - subtotalCents) / 100, weights);
  return linesDifferFromExpected(new Map(creditNote.items.map((item, index) => [item.id,
    { exVat: -bases[index], incVat: -(cents(bases[index]) + cents(taxes[index])) / 100 }])), lines);
}

function recordDocumentDelta(result: PeriodDeltas, documentDate: Date,
  delta: { exVat: number; incVat: number; sales: number },
): void {
  if (delta.exVat === 0 && delta.incVat === 0 && delta.sales === 0) return;
  result.mismatched++;
  const period = getThailandMonthKey(documentDate);
  const entry = result.periods[period] ?? { count: 0, revenueDeltaCents: 0, netProfitDeltaCents: 0 };
  entry.count++;
  entry.revenueDeltaCents += delta.exVat;
  entry.netProfitDeltaCents += delta.exVat;
  result.periods[period] = entry;
}

async function auditSales(): Promise<AuditResult> {
  const result = { scanned: 0, mismatched: 0, missingFacts: 0, invalidHeaders: 0,
    staleLineSubtotals: 0, salesWithAllocationDifferences: 0, periods: {} as Record<string, AuditPeriod> };
  let cursor: string | undefined;
  try {
    for (;;) {
      const sales = await db.sale.findMany({ where: { status: "ACTIVE" }, orderBy: { id: "asc" },
        take: BATCH_SIZE, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, saleDate: true, vatType: true, vatRate: true, subtotalAmount: true,
          netAmount: true, discount: true, shippingFee: true,
          items: { orderBy: { lineNo: "asc" }, select: { id: true, totalAmount: true, subtotalAmount: true } } },
      });
      if (sales.length === 0) break;
      const facts = await db.factProfit.groupBy({ by: ["sourceId"],
        where: { isActive: true, sourceType: "SALE", sourceId: { in: sales.map((sale) => sale.id) } },
        _sum: { salesAmountExVat: true, salesAmountIncVat: true, salesAmount: true },
      });
      const factsBySale = new Map(facts.map((fact) => [fact.sourceId, fact._sum]));
      const lineFacts = await db.factProfit.findMany({
        where: { isActive: true, sourceType: "SALE", sourceId: { in: sales.map((sale) => sale.id) } },
        select: { sourceId: true, sourceLineId: true, salesAmountExVat: true, salesAmountIncVat: true },
      });
      const linesBySale = Map.groupBy(lineFacts, (fact) => fact.sourceId);
      for (const sale of sales) {
        result.scanned++;
        result.staleLineSubtotals += sale.items.filter((item) => cents(Number(item.subtotalAmount)) !==
          cents(calcItemSubtotal(Number(item.totalAmount), sale.vatType, Number(sale.vatRate)))).length;
        try {
          const allocation = allocateSaleProfitRevenue({ itemAmounts: sale.items.map((item) => Number(item.totalAmount)),
            discount: Number(sale.discount), shippingFee: Number(sale.shippingFee),
            subtotalAmount: Number(sale.subtotalAmount), netAmount: Number(sale.netAmount) });
          if (hasAllocationDifference(sale.id, sale.items.map((item) => item.id), allocation, linesBySale.get(sale.id) ?? [])) {
            result.salesWithAllocationDifferences++;
          }
        } catch {
          result.invalidHeaders++;
          continue;
        }
        const fact = factsBySale.get(sale.id);
        if (!fact) { result.missingFacts++; continue; }
        recordDocumentDelta(result, sale.saleDate, {
          exVat: cents(Number(sale.subtotalAmount)) - cents(Number(fact.salesAmountExVat ?? 0)),
          incVat: cents(Number(sale.netAmount)) - cents(Number(fact.salesAmountIncVat ?? 0)),
          sales: cents(Number(sale.subtotalAmount)) - cents(Number(fact.salesAmount ?? 0)),
        });
      }
      cursor = sales[sales.length - 1].id;
    }
    return result;
  } catch (error) {
    throw new Error("Sale VAT audit failed", { cause: error });
  }
}

const creditNoteAuditSelect = { id: true, cnDate: true, type: true, vatType: true, vatRate: true,
  subtotalAmount: true, totalAmount: true,
  items: { orderBy: { lineNo: "asc" }, select: { id: true, amount: true, subtotalAmount: true } },
} satisfies Prisma.CreditNoteSelect;
type CreditNoteAuditRow = Prisma.CreditNoteGetPayload<{ select: typeof creditNoteAuditSelect }>;

async function loadCreditNoteBatch(cursor: string | undefined): Promise<CreditNoteAuditRow[]> {
  return db.creditNote.findMany({ where: { status: "ACTIVE" }, orderBy: { id: "asc" },
    take: BATCH_SIZE, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: creditNoteAuditSelect });
}

type CreditNoteFactLine = FactLine & { salesAmount: Prisma.Decimal; quantity: Prisma.Decimal; costAmount: Prisma.Decimal };

/** Every CN type reduces revenue; DISCOUNT/OTHER lines carry no quantity and no cost. */
function auditCreditNote(result: CreditNoteAuditResult, creditNote: CreditNoteAuditRow,
  lines: CreditNoteFactLine[],
): void {
  result.scanned++;
  result.staleLineSubtotals += creditNote.items.filter((item) => cents(Number(item.subtotalAmount)) !==
    cents(calcItemSubtotal(Number(item.amount), creditNote.vatType, Number(creditNote.vatRate)))).length;
  if (creditNote.items.length === 0) return;
  if (lines.length === 0) { result.missingFacts++; return; }
  if (isValueOnlyCreditNoteType(creditNote.type)) {
    result.valueOnlyFactLinesWithQuantityOrCost += lines.filter((line) =>
      Number(line.quantity) !== 0 || cents(Number(line.costAmount)) !== 0).length;
  }
  // A return line must never carry positive revenue or a VAT share of the opposite sign.
  result.wrongSignFactLines += lines.filter((line) => Number(line.salesAmountExVat) > 0 ||
    cents(Number(line.salesAmountIncVat)) > cents(Number(line.salesAmountExVat))).length;
  if (hasReturnAllocationDifference(creditNote, lines)) result.creditNotesWithAllocationDifferences++;
  const factCents = (field: "salesAmountExVat" | "salesAmountIncVat" | "salesAmount"): number =>
    lines.reduce((total, line) => total + cents(Number(line[field])), 0);
  recordDocumentDelta(result, creditNote.cnDate, {
    exVat: -cents(Number(creditNote.subtotalAmount)) - factCents("salesAmountExVat"),
    incVat: -cents(Number(creditNote.totalAmount)) - factCents("salesAmountIncVat"),
    sales: -cents(Number(creditNote.subtotalAmount)) - factCents("salesAmount"),
  });
}

/** Active credit notes: stale line subtotals and SALE_RETURN facts against posted header cents. */
async function auditCreditNotes(): Promise<CreditNoteAuditResult> {
  const result: CreditNoteAuditResult = { scanned: 0, mismatched: 0, missingFacts: 0, staleLineSubtotals: 0,
    wrongSignFactLines: 0, creditNotesWithAllocationDifferences: 0, valueOnlyFactLinesWithQuantityOrCost: 0, periods: {} };
  let cursor: string | undefined;
  try {
    for (;;) {
      const creditNotes = await loadCreditNoteBatch(cursor);
      if (creditNotes.length === 0) break;
      const lineFacts = await db.factProfit.findMany({
        where: { isActive: true, sourceType: "SALE_RETURN", sourceId: { in: creditNotes.map((doc) => doc.id) } },
        select: { sourceId: true, sourceLineId: true, salesAmountExVat: true, salesAmountIncVat: true, salesAmount: true,
          quantity: true, costAmount: true },
      });
      const linesByCreditNote = Map.groupBy(lineFacts, (fact) => fact.sourceId);
      for (const creditNote of creditNotes) {
        auditCreditNote(result, creditNote, linesByCreditNote.get(creditNote.id) ?? []);
      }
      cursor = creditNotes[creditNotes.length - 1].id;
    }
    return result;
  } catch (error) {
    throw new Error("Credit note VAT audit failed", { cause: error });
  }
}

/** Cancelled documents must not keep active facts; counts documents that still do. */
async function countCancelledWithActiveFacts(sourceType: ProfitSourceType,
  loadPage: (cursor: string | undefined) => Promise<{ id: string }[]>,
): Promise<CancelledAudit> {
  const result: CancelledAudit = { scanned: 0, withActiveFacts: 0 };
  let cursor: string | undefined;
  for (;;) {
    const documents = await loadPage(cursor);
    if (documents.length === 0) return result;
    result.scanned += documents.length;
    const active = await db.factProfit.groupBy({ by: ["sourceId"],
      where: { isActive: true, sourceType, sourceId: { in: documents.map((doc) => doc.id) } } });
    result.withActiveFacts += active.length;
    cursor = documents[documents.length - 1].id;
  }
}

/**
 * A marketplace settlement writes OTHER_INCOME facts under its own id and its fee as EXPENSE
 * facts under its fee expense id; a cancelled settlement must keep neither active.
 */
async function countCancelledSettlementsWithActiveFacts(
  loadPage: (cursor: string | undefined) => Promise<{ id: string; expenseId: string | null }[]>,
): Promise<CancelledAudit> {
  const result: CancelledAudit = { scanned: 0, withActiveFacts: 0 };
  let cursor: string | undefined;
  for (;;) {
    const settlements = await loadPage(cursor);
    if (settlements.length === 0) return result;
    result.scanned += settlements.length;
    const expenseIds = settlements.flatMap((doc) => (doc.expenseId ? [doc.expenseId] : []));
    const active = await db.factProfit.groupBy({ by: ["sourceType", "sourceId"],
      where: { isActive: true, OR: [
        { sourceType: "OTHER_INCOME", sourceId: { in: settlements.map((doc) => doc.id) } },
        { sourceType: "EXPENSE", sourceId: { in: expenseIds } },
      ] } });
    const activeKeys = new Set(active.map((row) => `${row.sourceType}:${row.sourceId}`));
    result.withActiveFacts += settlements.filter((doc) => activeKeys.has(`OTHER_INCOME:${doc.id}`) ||
      (doc.expenseId !== null && activeKeys.has(`EXPENSE:${doc.expenseId}`))).length;
    cursor = settlements[settlements.length - 1].id;
  }
}

type CancelledDocumentsAudit = {
  sales: CancelledAudit; creditNotes: CancelledAudit; expenses: CancelledAudit;
  supplierDebitNotes: CancelledAudit; marketplaceSettlements: CancelledAudit;
};

async function auditCancelledDocuments(): Promise<CancelledDocumentsAudit> {
  const page = (cursor: string | undefined) => ({ where: { status: "CANCELLED" as const },
    orderBy: { id: "asc" as const }, take: BATCH_SIZE, select: { id: true },
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
  try {
    const [sales, creditNotes, expenses, supplierDebitNotes, marketplaceSettlements] = await Promise.all([
      countCancelledWithActiveFacts("SALE", (cursor) => db.sale.findMany(page(cursor))),
      countCancelledWithActiveFacts("SALE_RETURN", (cursor) => db.creditNote.findMany(page(cursor))),
      countCancelledWithActiveFacts("EXPENSE", (cursor) => db.expense.findMany(page(cursor))),
      countCancelledWithActiveFacts("PURCHASE_COST_VARIANCE", (cursor) => db.supplierDebitNote.findMany(page(cursor))),
      countCancelledSettlementsWithActiveFacts((cursor) => db.marketplaceSettlement.findMany({
        ...page(cursor), select: { id: true, expenseId: true } })),
    ]);
    return { sales, creditNotes, expenses, supplierDebitNotes, marketplaceSettlements };
  } catch (error) {
    throw new Error("Cancelled document audit failed", { cause: error });
  }
}

async function auditSourceSubtotals(): Promise<{
  purchaseItems: number; purchaseReturns: number; purchaseReturnLines: number;
}> {
  try {
    const [items, returns, returnLines] = await Promise.all([
      db.purchaseItem.findMany({ where: { purchase: { status: "ACTIVE", vatType: "INCLUDING_VAT" } },
        select: { totalAmount: true, subtotalAmount: true, purchase: { select: { vatRate: true } } } }),
      db.purchaseReturn.findMany({ where: { status: "ACTIVE", vatType: "INCLUDING_VAT" },
        select: { totalAmount: true, subtotalAmount: true, vatAmount: true, vatRate: true } }),
      db.purchaseReturnItem.findMany({ where: { purchaseReturn: { status: "ACTIVE" } },
        select: { amount: true, subtotalAmount: true, purchaseReturn: { select: { vatType: true, vatRate: true } } } }),
    ]);
    return {
      purchaseItems: items.filter((item) => cents(Number(item.subtotalAmount)) !==
        cents(calcItemSubtotal(Number(item.totalAmount), "INCLUDING_VAT", Number(item.purchase.vatRate)))).length,
      // The header was posted with calcVat() on the tax-inclusive total, so re-derive it the same way.
      purchaseReturns: returns.filter((doc) => {
        const header = calcVat(Number(doc.totalAmount), "INCLUDING_VAT", Number(doc.vatRate));
        return cents(Number(doc.subtotalAmount)) !== cents(header.subtotalAmount) ||
          cents(Number(doc.vatAmount)) !== cents(header.vatAmount);
      }).length,
      purchaseReturnLines: returnLines.filter((line) => cents(Number(line.subtotalAmount)) !==
        cents(calcItemSubtotal(Number(line.amount), line.purchaseReturn.vatType, Number(line.purchaseReturn.vatRate)))).length,
    };
  } catch (error) {
    throw new Error("Source subtotal audit failed", { cause: error });
  }
}

type StockValueResidualAudit = { residualRows: number; activeFacts: number; rowsWithoutFact: number; staleFacts: number };

/**
 * T3: every StockCard row with a written-off stock value (non-DN costVariance, from the go-live date) must have
 * exactly one active STOCK_VALUE_RESIDUAL fact with the same date and amount, and no active fact may outlive its row.
 */
async function auditStockValueResidualFacts(): Promise<StockValueResidualAudit> {
  try {
    const rows = await db.stockCard.findMany({
      where: { docDate: { gte: parseDateOnlyToStartOfDay(STOCK_VALUE_RESIDUAL_START_DATE) }, source: { not: "SUPPLIER_DEBIT" },
        costVariance: { not: 0 } },
      select: { id: true, docDate: true, costVariance: true },
    });
    const facts = await db.factProfit.findMany({ where: { isActive: true, sourceType: "STOCK_VALUE_RESIDUAL" },
      select: { sourceLineId: true, businessDate: true, costAmount: true } });
    const key = (id: string | null, date: Date, amount: Prisma.Decimal): string => `${id ?? ""}|${date.getTime()}|${cents(Number(amount))}`;
    const rowKeys = new Set(rows.map((row) => key(row.id, row.docDate, row.costVariance)));
    const factKeys = new Set(facts.map((fact) => key(fact.sourceLineId, fact.businessDate, fact.costAmount)));
    return { residualRows: rows.length, activeFacts: facts.length,
      rowsWithoutFact: [...rowKeys].filter((rowKey) => !factKeys.has(rowKey)).length,
      staleFacts: facts.filter((fact) => !rowKeys.has(key(fact.sourceLineId, fact.businessDate, fact.costAmount))).length };
  } catch (error) {
    throw new Error("Stock value residual audit failed", { cause: error });
  }
}

async function main(): Promise<void> {
  try {
    const [sales, creditNotes, cancelledDocuments, sourceSubtotals, stockValueResidual, distributions] = await Promise.all([
      auditSales(), auditCreditNotes(), auditCancelledDocuments(), auditSourceSubtotals(), auditStockValueResidualFacts(),
      db.profitDistribution.findMany({ where: { status: "ACTIVE" },
        select: { periodYear: true, periodMonth: true } }),
    ]);
    const distributedPeriods = distributions.map((doc) => `${doc.periodYear}-${String(doc.periodMonth).padStart(2, "0")}`);
    console.log(JSON.stringify({ mode: "READ_ONLY", sales, creditNotes, cancelledDocuments, sourceSubtotals, stockValueResidual,
      affectedDistributedPeriods: distributedPeriods.filter((period) =>
        period in sales.periods || period in creditNotes.periods),
      activeDistributionCount: distributions.length,
      warning: "Rebuilding historical profit may change future distribution carry-forward. Source subtotals require a separate correction review.",
    }, null, 2));
  } catch (error) {
    console.error("[audit-sale-profit-vat]", error);
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

void main();
