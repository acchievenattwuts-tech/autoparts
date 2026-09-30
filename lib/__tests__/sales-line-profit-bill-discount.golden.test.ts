import assert from "node:assert/strict";
import test, { before, mock } from "node:test";

import { allocateSaleProfitRevenue } from "@/lib/sale-profit-revenue";
import { calcVat, type VatType } from "@/lib/vat";

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

const VAT_RATE = 7;
const modes: VatType[] = ["NO_VAT", "EXCLUDING_VAT", "INCLUDING_VAT"];
const saleDate = new Date("2026-09-15T00:00:00+07:00");

type Fixture = {
  vatType: VatType;
  discount: number;
  items: Array<{ id: string; totalAmount: number; exVat: number; incVat: number }>;
};

/** Build facts exactly as rebuildSaleProfitFacts would from the posted header. */
function buildFixture(vatType: VatType, itemAmounts: number[], discount: number): Fixture {
  const header = calcVat(itemAmounts.reduce((sum, amount) => sum + amount, 0) - discount, vatType, VAT_RATE);
  const revenue = allocateSaleProfitRevenue({ itemAmounts, discount, shippingFee: 0,
    subtotalAmount: header.subtotalAmount, netAmount: header.netAmount });
  return {
    vatType,
    discount,
    items: itemAmounts.map((totalAmount, index) => ({ id: `line-${index + 1}`, totalAmount,
      exVat: revenue.items[index].exVat, incVat: revenue.items[index].incVat })),
  };
}

let fixture = buildFixture("EXCLUDING_VAT", [1000], 0);
let reportModule: typeof import("@/lib/sales-line-profit-report");

function factRows() {
  return fixture.items.map((item) => ({
    sourceType: "SALE", sourceId: "sale-1", sourceLineId: item.id, sourceDocNo: "IV202609150001",
    referenceDocNo: null, businessDate: saleDate, customerName: "ลูกค้าทดสอบ", channel: "STORE",
    productCode: item.id, productName: item.id, quantity: 1, salesAmountIncVat: item.incVat,
    salesAmountExVat: item.exVat, costAmount: 0, grossProfit: item.exVat,
  }));
}

function sum(field: "exVat" | "incVat"): number {
  return fixture.items.reduce((total, item) => total + item[field], 0);
}

before(async () => {
  if (moduleMocksUnavailable) return;
  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        factProfit: {
          groupBy: async () => [{ sourceType: "SALE", sourceId: "sale-1", sourceDocNo: "IV202609150001",
            referenceDocNo: null, businessDate: saleDate, customerName: "ลูกค้าทดสอบ", channel: "STORE",
            _sum: { quantity: fixture.items.length, salesAmountIncVat: sum("incVat"),
              salesAmountExVat: sum("exVat"), costAmount: 0, grossProfit: sum("exVat") } }],
          aggregate: async (args: { where?: { productId?: unknown } }) => args.where?.productId
            ? { _sum: { salesAmountIncVat: sum("incVat") } }
            : { _sum: { salesAmountIncVat: sum("incVat"), salesAmountExVat: sum("exVat"),
              costAmount: 0, grossProfit: sum("exVat") } },
          count: async () => fixture.items.length,
          findMany: async () => factRows(),
        },
        sale: { findMany: async () => [{ id: "sale-1", discount: fixture.discount }] },
        saleItem: {
          findMany: async (args: { where: { id: { in: string[] } } }) => fixture.items
            .filter((item) => args.where.id.in.includes(item.id))
            .map((item) => ({ id: item.id, quantity: 1, showQty: null, showUnitName: "ชิ้น",
              unitListPrice: item.totalAmount, lineDiscount: 0, totalAmount: item.totalAmount,
              sale: { vatType: fixture.vatType } })),
        },
        creditNoteItem: { findMany: async () => [] },
      },
    },
  });
  reportModule = await import("@/lib/sales-line-profit-report");
});

async function queryReport() {
  const filters = reportModule.parseSalesLineProfitFilters({ from: "2026-09-01", to: "2026-09-30" });
  return reportModule.querySalesLineProfitData(filters);
}

test("golden EXCLUDING_VAT 1,000 line without bill discount allocates 0.00, not -70.00", { skip: moduleMocksUnavailable }, async () => {
  fixture = buildFixture("EXCLUDING_VAT", [1000], 0);
  assert.equal(fixture.items[0].incVat, 1070);
  const data = await queryReport();
  assert.equal(data.lines[0].allocatedBillDiscount, 0);
  assert.equal(data.totals.allocatedBillDiscount, 0);
});

for (const mode of modes) {
  test(`golden ${mode}: bill discount 100 over lines 600/400 allocates 60.00/40.00`, { skip: moduleMocksUnavailable }, async () => {
    fixture = buildFixture(mode, [600, 400], 100);
    const data = await queryReport();
    assert.deepEqual(data.lines.map((line) => line.allocatedBillDiscount), [60, 40]);
    assert.equal(data.totals.allocatedBillDiscount, 100);
    assert.equal(data.bills[0].billDiscount, 100);
  });
}

test("golden NO_VAT and INCLUDING_VAT keep the tax-inclusive comparison unchanged", { skip: moduleMocksUnavailable }, () => {
  for (const mode of ["NO_VAT", "INCLUDING_VAT"] as const) {
    for (const [amounts, discount] of [[[1000], 0], [[600, 400], 100], [[33.33, 66.67, 0.01], 7.77]] as const) {
      const built = buildFixture(mode, [...amounts], discount);
      for (const item of built.items) {
        const fact = { salesAmountExVat: item.exVat, salesAmountIncVat: item.incVat };
        const previous = Math.round((item.totalAmount - item.incVat + Number.EPSILON) * 100) / 100;
        assert.equal(reportModule.calcAllocatedBillDiscount(item.totalAmount, fact, mode), previous);
      }
    }
  }
});
