import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@/lib/generated/prisma";
import { parseDateOnlyToDate } from "@/lib/th-date";
import {
  planProductRestatement, restateReferenceCost, restateSaleUnitCost, summarizeSaleCostRestatement,
  type PlanReturnItem, type PlanSaleItem, type PlanSourceSaleItem, type PlanStockRow, type ProductRestatementInput,
} from "@/lib/sale-cost-restatement";

// T1 option A (owner approved 2026-09-30): cancelling or editing a supplier DN restates the cost of
// every later sale on its SKUs (and the reference cost of RETURN credit notes built on those sales).

const D = (value: number) => new Prisma.Decimal(value);
const DAY = { receipt: "2026-09-26", debit: "2026-09-27", sale: "2026-09-28", credit: "2026-09-29", later: "2026-09-30" } as const;
const stock = (id: string, day: string, sorder: number, source: string, qtyIn: number, qtyOut: number, priceIn: number,
  extra: { referenceId?: string; usesReferenceCost?: boolean; valueAdjustment?: number; epoch?: number; docNo?: string } = {}): PlanStockRow => ({
  id, productId: "sku", docNo: extra.docNo ?? `DOC-${id}`, referenceId: extra.referenceId ?? null,
  docDate: parseDateOnlyToDate(day), sorder, source, valuationEpoch: extra.epoch ?? 0,
  qtyIn: D(qtyIn), qtyOut: D(qtyOut), priceIn: D(priceIn), landedCost: D(0), usesReferenceCost: extra.usesReferenceCost ?? false,
  valueAdjustment: D(extra.valueAdjustment ?? 0), costVariance: D(0), qtyBalance: D(0), priceBalance: D(0), priceOut: D(0),
});
const saleItem = (id: string, saleNo: string, day: string, quantity: number, costPrice: number): PlanSaleItem => ({
  id, saleId: `sale-${id}`, saleNo, saleDate: parseDateOnlyToDate(day), saleActive: true, productId: "sku", quantity, costPrice,
});

/** Receive 10 @ 100, sell 6, DN +50 x 10 with 4 on hand (+200 -> 4 @ 150), then sell 2 at the DN cost 150. */
const baseRows = (): PlanStockRow[] => [
  stock("receipt", DAY.receipt, 1, "PURCHASE", 10, 0, 100),
  stock("sale-1", DAY.receipt, 2, "SALE", 0, 6, 0, { referenceId: "si-1" }),
  stock("dn", DAY.debit, 3, "SUPPLIER_DEBIT", 0, 0, 0, { valueAdjustment: 200, epoch: 1, docNo: "SDN1" }),
  stock("sale-2", DAY.sale, 4, "SALE", 0, 2, 0, { referenceId: "si-2" }),
];
const baseItems = (): Map<string, PlanSaleItem> => new Map([
  ["si-1", saleItem("si-1", "SA-1", DAY.receipt, 6, 100)], ["si-2", saleItem("si-2", "SA-2", DAY.sale, 2, 150)],
]);
const input = (overrides: Partial<ProductRestatementInput> = {}): ProductRestatementInput => ({
  rows: baseRows(), debitNo: "SDN1", replacements: [], saleItems: baseItems(),
  returnItems: new Map<string, PlanReturnItem>(), sourceSaleItems: [], ...overrides,
});
const plan = (result: ReturnType<typeof planProductRestatement>) => ({
  saleItems: result.saleItems, returnRows: result.returnRows, residualRows: result.residualRows, creditNotes: [], unlinkedSaleRows: result.unlinkedSaleRows,
});

describe("sale cost restatement planner (pure)", () => {
  it("cancel: the 2 units sold after the DN re-cost 150 -> 100; the sale before the DN is untouched; gross profit +100", () => {
    const result = planProductRestatement(input());
    assert.deepEqual(result.saleItems.map((item) => [item.id, item.before, item.after]), [["si-2", 150, 100]]);
    const summary = summarizeSaleCostRestatement(plan(result));
    assert.deepEqual([summary.saleCount, summary.saleNos, summary.costBefore, summary.costAfter, summary.delta], [1, ["SA-2"], 300, 200, -100]);
  });

  it("edit to +30/unit at the original date and epoch: 4 on hand at that position -> +120, the same sale costs 130", () => {
    const result = planProductRestatement(input({ replacements: [{ productId: "sku", docDate: parseDateOnlyToDate(DAY.debit), valuationEpoch: 1, valueAdjustment: 120 }] }));
    assert.deepEqual(result.saleItems.map((item) => [item.id, item.before, item.after]), [["si-2", 150, 130]]);
    assert.equal(summarizeSaleCostRestatement(plan(result)).delta, -40);
  });

  it("a DN with no later sale restates nothing", () => {
    const result = planProductRestatement(input({ rows: baseRows().filter((row) => row.id !== "sale-2") }));
    assert.deepEqual(result, { saleItems: [], returnRows: [], residualRows: [], unlinkedSaleRows: 0 });
  });

  it("a return of a restated sale re-costs at the restated cost, so a later sale is not distorted (converges)", () => {
    // After the DN: sale-2 takes 2 @ 150; the customer returns 1 of them at its cost 150; sale-3 takes 1 @ 150.
    const rows = [...baseRows(), stock("cn-1", DAY.credit, 5, "RETURN_IN", 1, 0, 150, { referenceId: "cni-1", usesReferenceCost: true }),
      stock("sale-3", DAY.later, 6, "SALE", 0, 1, 0, { referenceId: "si-3" })];
    const saleItems = baseItems().set("si-3", saleItem("si-3", "SA-3", DAY.later, 1, 150));
    const returnItems = new Map<string, PlanReturnItem>([["cni-1", { id: "cni-1", creditNoteId: "cn", saleId: "sale-si-2", saleItemId: "si-2", productId: "sku", active: true }]]);
    const sourceSaleItems: PlanSourceSaleItem[] = [{ id: "si-2", saleId: "sale-si-2", productId: "sku", quantity: 2, costPrice: 150 }];
    const result = planProductRestatement(input({ rows, saleItems, returnItems, sourceSaleItems }));
    // Without restating the return's cost, sale-3 would cost (2 x 100 + 150) / 3 = 116.67.
    assert.deepEqual(result.saleItems.map((item) => [item.id, item.after]), [["si-2", 100], ["si-3", 100]]);
    assert.deepEqual(result.returnRows.map((row) => [row.stockCardId, row.before, row.after]), [["cn-1", 150, 100]]);
  });

  it("a cancelled credit note keeps its stock row cost", () => {
    const rows = [...baseRows(), stock("cn-1", DAY.credit, 5, "RETURN_IN", 1, 0, 150, { referenceId: "cni-1", usesReferenceCost: true })];
    const returnItems = new Map<string, PlanReturnItem>([["cni-1", { id: "cni-1", creditNoteId: "cn", saleId: "sale-si-2", saleItemId: "si-2", productId: "sku", active: false }]]);
    const result = planProductRestatement(input({ rows, returnItems, sourceSaleItems: [{ id: "si-2", saleId: "sale-si-2", productId: "sku", quantity: 2, costPrice: 150 }] }));
    assert.deepEqual(result.returnRows, []);
  });

  it("a stock row linked to no sale line is counted, never guessed", () => {
    const rows = baseRows().map((row) => (row.id === "sale-2" ? { ...row, referenceId: null } : row));
    const result = planProductRestatement(input({ rows }));
    assert.deepEqual([result.saleItems.length, result.unlinkedSaleRows], [0, 1]);
  });

  it("a later residual that the DN change moves is reported for the month lock", () => {
    // A purchase return empties stock after the DN: with the DN 200 is written off; without it nothing is.
    const rows = [...baseRows().filter((row) => row.id !== "sale-2"),
      stock("return", "2026-10-02", 1, "RETURN_OUT", 0, 4, 100, { usesReferenceCost: true })];
    const result = planProductRestatement(input({ rows }));
    assert.deepEqual(result.residualRows.map((row) => [row.stockCardId, row.before, row.after]), [["return", 200, 0]]);
  });
});

describe("restatement rounding", () => {
  it("a snapshot equal to the stored valuation takes the new valuation, rounded like Product.avgCost (2 dp)", () => {
    assert.equal(restateSaleUnitCost(150, 150, 100), 100);
    assert.equal(restateSaleUnitCost(133.33, 133.3333, 116.6667), 116.67);
  });
  it("a snapshot that already differed (backdated sale) moves by the valuation change only", () => {
    assert.equal(restateSaleUnitCost(140, 150, 100), 90);
    assert.equal(restateSaleUnitCost(20, 150, 100), 0);
  });
  it("a return reference cost follows the same rule at 4 dp", () => {
    assert.equal(restateReferenceCost(150, 150, 100), 100);
    assert.equal(restateReferenceCost(116.6667, 116.66666, 100), 100);
    assert.equal(restateReferenceCost(120, 150, 100), 70);
  });
});
