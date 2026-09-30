import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@/lib/generated/prisma";
import { parseDateOnlyToDate } from "@/lib/th-date";
import { replayStockCardMavg, sortRowsForReplay, writeStockCard } from "@/lib/stock-card";
import { DocumentMutationBlockedError } from "@/lib/document-mutation-guard";
import { isUserFacingDocumentError } from "@/lib/document-user-error";
import { allocateSupplierDebitCoverage } from "@/lib/supplier-debit-note-calculation";

const decimal = (value: number) => new Prisma.Decimal(value);
type Row = Parameters<typeof replayStockCardMavg>[0][number];
const row = (id: string, source: string, qtyIn: number, qtyOut: number,
  priceIn: number, valueAdjustment = 0, epoch = 0, day = "2026-09-29", sorder = 1): Row => ({
  id, source, qtyIn: decimal(qtyIn), qtyOut: decimal(qtyOut), priceIn: decimal(priceIn),
  landedCost: decimal(0), usesReferenceCost: false, valueAdjustment: decimal(valueAdjustment),
  valuationEpoch: epoch, docDate: parseDateOnlyToDate(day), sorder,
  qtyBalance: decimal(-999), priceBalance: decimal(-999), priceOut: decimal(-999),
});
const replay = (rows: Row[]) => replayStockCardMavg(sortRowsForReplay(rows));
const costOut = (result: ReturnType<typeof replay>, id: string) => result.updates.find((item) => item.id === id)?.priceOut;

describe("supplier DN: fixed inventory and issue-cost golden scenarios", () => {
  it("backdated stock is refused before insertion, naming the latest DN and its posting date", async () => {
    let writes = 0;
    let orderBy: unknown;
    const tx = { $queryRaw: async () => [], stockCard: {
      findFirst: async (args: { orderBy?: unknown }) => {
        orderBy = args.orderBy;
        return { docNo: "SDN26090001", docDate: parseDateOnlyToDate("2026-09-29") };
      },
      create: async () => { writes += 1; return { id: "unexpected" }; },
    } } as unknown as Prisma.TransactionClient;
    await assert.rejects(writeStockCard(tx, { productId: "sku", docNo: "new-backdated-sale",
      docDate: parseDateOnlyToDate("2026-09-28"), source: "SALE", qtyIn: 0, qtyOut: 1, priceIn: 0,
      detail: "test", valuationEpoch: 0 }), (error: unknown) => {
      assert.ok(error instanceof DocumentMutationBlockedError);
      assert.equal(isUserFacingDocumentError(error), true);
      assert.match(error.message, /SDN26090001/);
      assert.match(error.message, /ลงต้นทุนวันที่ 29\/09\/2026/);
      assert.match(error.message, /ตั้งแต่ 29\/09\/2026 เป็นต้นไป/);
      assert.doesNotMatch(error.message, /ยกเลิก/);
      return true;
    });
    assert.deepEqual(orderBy, [{ docDate: "desc" }, { sorder: "desc" }]);
    assert.equal(writes, 0);
  });
  it("fractional stock: DN capitalized on the true 0.5 on hand gives MAVG 150 (Product.stock 1 would give 200)", () => {
    const rows = (adjustment: number) => [
      row("receipt", "PURCHASE", 10, 0, 100),
      row("sale", "SALE", 0, 9.5, 0, 0, 0, "2026-09-29", 2),
      row("dn", "SUPPLIER_DEBIT", 0, 0, 0, adjustment, 1, "2026-09-29", 3),
    ];
    // DN +50 x 10 = 500 over 10 affected units: 0.5 covered -> 25; 1 covered (rounded stock) -> 50.
    assert.deepEqual(allocateSupplierDebitCoverage([{ productId: "sku", affectedBaseQuantity: 10, costAdjustmentAmount: 500 }],
      new Map([["sku", 0.5]])), [{ eligibleBaseQuantity: 0.5, inventoryAmount: 25, varianceAmount: 475 }]);
    assert.equal(replay(rows(25)).finalPrice, 150);
    assert.equal(replay(rows(50)).finalPrice, 200);
  });
  it("removing a tail DN row leaves every earlier balance and every quantity unchanged (repost ordering)", () => {
    const before = [
      row("receipt", "PURCHASE", 10, 0, 100),
      row("sale", "SALE", 0, 6, 0, 0, 0, "2026-09-29", 2),
    ];
    const withDebit = replay([...before, row("dn", "SUPPLIER_DEBIT", 0, 0, 0, 200, 1, "2026-09-29", 3)]);
    const without = replay(before);
    for (const id of ["receipt", "sale"]) {
      assert.deepEqual(withDebit.updates.find((item) => item.id === id), without.updates.find((item) => item.id === id));
    }
    // The DN row carries the same quantity as the row before it, so coverage read before or after the reversal is equal.
    assert.equal(withDebit.updates.find((item) => item.id === "dn")?.qtyBalance, without.updates.find((item) => item.id === "sale")?.qtyBalance);
    assert.equal(withDebit.finalQty, without.finalQty);
  });
  it("partial coverage preserves earlier sale cost and raises future sale cost", () => {
    const result = replay([
      row("receipt", "PURCHASE", 10, 0, 100),
      row("old-sale", "SALE", 0, 6, 0, 0, 0, "2026-09-29", 2),
      row("dn", "SUPPLIER_DEBIT", 0, 0, 0, 200, 1, "2026-09-29", 3),
      row("new-sale", "SALE", 0, 1, 0, 0, 1, "2026-09-29", 4),
    ]);
    assert.equal(costOut(result, "old-sale"), 100);
    assert.equal(costOut(result, "new-sale"), 150);
    assert.equal(result.finalQty, 3);
    assert.equal(result.finalPrice, 150);
  });
  it("zero-stock DN does not carry value into a later receipt", () => {
    const result = replay([
      row("receipt", "PURCHASE", 10, 0, 100),
      row("sale", "SALE", 0, 10, 0, 0, 0, "2026-09-29", 2),
      row("dn", "SUPPLIER_DEBIT", 0, 0, 0, 0, 1, "2026-09-29", 3),
      row("next-receipt", "PURCHASE", 10, 0, 120, 0, 0, "2026-09-30"),
    ]);
    assert.equal(costOut(result, "sale"), 100);
    assert.equal(result.finalQty, 10);
    assert.equal(result.finalPrice, 120);
  });
  it("replenished aggregate stock receives old receipt DN as approved", () => {
    const result = replay([
      row("old-receipt", "PURCHASE", 10, 0, 100, 0, 0, "2026-09-27"),
      row("old-sale", "SALE", 0, 10, 0, 0, 0, "2026-09-28"),
      row("new-receipt", "PURCHASE", 10, 0, 120),
      row("dn", "SUPPLIER_DEBIT", 0, 0, 0, 500, 1),
    ]);
    assert.equal(costOut(result, "old-sale"), 100);
    assert.equal(result.finalQty, 10);
    assert.equal(result.finalPrice, 170);
  });
  it("receipt after same-day DN cannot move before the DN boundary", () => {
    const result = replay([
      row("receipt", "PURCHASE", 10, 0, 100, 0, 0, "2026-09-29", 1),
      row("sale", "SALE", 0, 6, 0, 0, 0, "2026-09-29", 2),
      row("dn", "SUPPLIER_DEBIT", 0, 0, 0, 200, 1, "2026-09-29", 3),
      row("later-receipt", "PURCHASE", 6, 0, 200, 0, 1, "2026-09-29", 4),
      row("later-sale", "SALE", 0, 1, 0, 0, 1, "2026-09-29", 5),
    ]);
    assert.equal(costOut(result, "sale"), 100);
    assert.equal(costOut(result, "later-sale"), 180);
    assert.equal(result.finalPrice, 180);
    assert.equal(result.finalQty, 9);
  });
  it("two boundaries preserve all issue-cost eras", () => {
    const result = replay([
      row("receipt", "PURCHASE", 10, 0, 100),
      row("sale-0", "SALE", 0, 2, 0, 0, 0, "2026-09-29", 2),
      row("dn-1", "SUPPLIER_DEBIT", 0, 0, 0, 400, 1, "2026-09-29", 3),
      row("sale-1", "SALE", 0, 2, 0, 0, 1, "2026-09-29", 4),
      row("dn-2", "SUPPLIER_DEBIT", 0, 0, 0, 120, 2, "2026-09-29", 5),
      row("sale-2", "SALE", 0, 1, 0, 0, 2, "2026-09-29", 6),
    ]);
    assert.deepEqual([costOut(result, "sale-0"), costOut(result, "sale-1"), costOut(result, "sale-2")], [100, 150, 170]);
    assert.equal(result.finalQty, 5);
  });
  it("cancelling an unreferenced last DN restores original inventory value", () => {
    const original = [row("receipt", "PURCHASE", 10, 0, 100)];
    assert.equal(replay([...original, row("dn", "SUPPLIER_DEBIT", 0, 0, 0, 500, 1)]).finalPrice, 150);
    assert.equal(replay(original).finalPrice, 100);
  });
  it("rejects quantity changes and capitalization with no stock", () => {
    assert.throws(() => replay([row("dn", "SUPPLIER_DEBIT", 1, 0, 0)]), /quantity/);
    assert.throws(() => replay([row("dn", "SUPPLIER_DEBIT", 0, 0, 0, 50)]), /positive stock/);
  });
});

describe("supplier DN: pooled SKU coverage golden scenarios", () => {
  const lines = [
    { productId: "sku", affectedBaseQuantity: 10, costAdjustmentAmount: 500 },
    { productId: "sku", affectedBaseQuantity: 10, costAdjustmentAmount: 1000 },
  ];
  it("duplicate SKU lines share stock once", () => {
    assert.deepEqual(allocateSupplierDebitCoverage(lines, new Map([["sku", 4]])), [
      { eligibleBaseQuantity: 2, inventoryAmount: 100, varianceAmount: 400 },
      { eligibleBaseQuantity: 2, inventoryAmount: 200, varianceAmount: 800 },
    ]);
  });
  it("coverage caps at affected quantity even when stock is greater", () => {
    assert.deepEqual(allocateSupplierDebitCoverage(lines, new Map([["sku", 30]])), [
      { eligibleBaseQuantity: 10, inventoryAmount: 500, varianceAmount: 0 },
      { eligibleBaseQuantity: 10, inventoryAmount: 1000, varianceAmount: 0 },
    ]);
  });
  it("negative stock has no capitalization", () => {
    assert.deepEqual(allocateSupplierDebitCoverage(lines, new Map([["sku", -1]])), [
      { eligibleBaseQuantity: 0, inventoryAmount: 0, varianceAmount: 500 },
      { eligibleBaseQuantity: 0, inventoryAmount: 0, varianceAmount: 1000 },
    ]);
  });
  it("pooled half-cent residual is capitalized once", () => {
    assert.deepEqual(allocateSupplierDebitCoverage([
      { productId: "sku", affectedBaseQuantity: 1, costAdjustmentAmount: 0.01 },
      { productId: "sku", affectedBaseQuantity: 1, costAdjustmentAmount: 0.01 },
    ], new Map([["sku", 1]])), [
      { eligibleBaseQuantity: 0.5, inventoryAmount: 0.01, varianceAmount: 0 },
      { eligibleBaseQuantity: 0.5, inventoryAmount: 0, varianceAmount: 0.01 },
    ]);
  });
});
