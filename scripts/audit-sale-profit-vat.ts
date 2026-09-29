/** Read-only audit. Does not rebuild facts or amend source documents.
 * Run: npx tsx --env-file=.env.local scripts/audit-sale-profit-vat.ts
 */
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma";
import { allocateSaleProfitRevenue } from "@/lib/sale-profit-revenue";
import { calcItemSubtotal } from "@/lib/vat";
import { getThailandMonthKey } from "@/lib/th-date";

const BATCH_SIZE = 100;
const cents = (amount: number): number => Math.round(amount * 100);
type AuditPeriod = { count: number; revenueDeltaCents: number; netProfitDeltaCents: number };
type AuditResult = {
  scanned: number; mismatched: number; missingFacts: number; invalidHeaders: number;
  staleLineSubtotals: number; salesWithAllocationDifferences: number; periods: Record<string, AuditPeriod>;
};

function hasAllocationDifference(saleId: string, itemIds: string[],
  allocation: ReturnType<typeof allocateSaleProfitRevenue>,
  lines: { sourceLineId: string | null; salesAmountExVat: Prisma.Decimal; salesAmountIncVat: Prisma.Decimal }[],
): boolean {
  const expectedLines = new Map(itemIds.map((id, index) => [id, allocation.items[index]]));
  if (allocation.shipping.incVat > 0) expectedLines.set(`${saleId}:shipping`, allocation.shipping);
  return lines.length !== expectedLines.size || lines.some((line) => {
    const expected = expectedLines.get(line.sourceLineId ?? "");
    return !expected || cents(expected.exVat) !== cents(Number(line.salesAmountExVat)) ||
      cents(expected.incVat) !== cents(Number(line.salesAmountIncVat));
  }) || new Set(lines.map((line) => line.sourceLineId)).size !== expectedLines.size;
}

function recordDocumentDelta(result: AuditResult, saleDate: Date,
  delta: { exVat: number; incVat: number; sales: number },
): void {
  if (delta.exVat === 0 && delta.incVat === 0 && delta.sales === 0) return;
  result.mismatched++;
  const period = getThailandMonthKey(saleDate);
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

async function auditSourceSubtotals(): Promise<{ purchaseItems: number; purchaseReturns: number }> {
  try {
    const [items, returns] = await Promise.all([
      db.purchaseItem.findMany({ where: { purchase: { status: "ACTIVE", vatType: "INCLUDING_VAT" } },
        select: { totalAmount: true, subtotalAmount: true, purchase: { select: { vatRate: true } } } }),
      db.purchaseReturn.findMany({ where: { status: "ACTIVE", vatType: "INCLUDING_VAT" },
        select: { totalAmount: true, subtotalAmount: true, vatRate: true } }),
    ]);
    return {
      purchaseItems: items.filter((item) => cents(Number(item.subtotalAmount)) !==
        cents(calcItemSubtotal(Number(item.totalAmount), "INCLUDING_VAT", Number(item.purchase.vatRate)))).length,
      purchaseReturns: returns.filter((doc) => cents(Number(doc.subtotalAmount)) !==
        cents(calcItemSubtotal(Number(doc.totalAmount), "INCLUDING_VAT", Number(doc.vatRate)))).length,
    };
  } catch (error) {
    throw new Error("Source subtotal audit failed", { cause: error });
  }
}

async function main(): Promise<void> {
  try {
    const [sales, sourceSubtotals, distributions] = await Promise.all([
      auditSales(), auditSourceSubtotals(),
      db.profitDistribution.findMany({ where: { status: "ACTIVE" },
        select: { periodYear: true, periodMonth: true } }),
    ]);
    const distributedPeriods = distributions.map((doc) => `${doc.periodYear}-${String(doc.periodMonth).padStart(2, "0")}`);
    console.log(JSON.stringify({ mode: "READ_ONLY", sales, sourceSubtotals,
      affectedDistributedPeriods: distributedPeriods.filter((period) => period in sales.periods),
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
