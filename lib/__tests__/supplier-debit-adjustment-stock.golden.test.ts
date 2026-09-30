import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@/lib/generated/prisma";
import { parseDateOnlyToDate } from "@/lib/th-date";
import { computeDebitValueResidual, replayStockCardMavg, sortRowsForReplay } from "@/lib/stock-card";

/**
 * A negative "ปรับยอด DN" value-only row (R5-D): the covered reduction lowers the stock value, never below zero; what
 * the on-hand value cannot absorb is a T3 write-off (negative residual = cost reduction) on that row.
 */
const D = (value: number): Prisma.Decimal => new Prisma.Decimal(value);
type ReplayRow = Parameters<typeof replayStockCardMavg>[0][number];
let seq = 0;
const row = (day: string, sorder: number, source: string, qtyIn: number, qtyOut: number, priceIn: number,
  valueAdjustment = 0, epoch = 0): ReplayRow => ({
  id: `a${String(++seq).padStart(2, "0")}`, docDate: parseDateOnlyToDate(day), sorder, source, qtyIn: D(qtyIn), qtyOut: D(qtyOut),
  priceIn: D(priceIn), landedCost: D(0), usesReferenceCost: false, valueAdjustment: D(valueAdjustment), valuationEpoch: epoch,
  qtyBalance: D(-999), priceBalance: D(-999), priceOut: D(-999),
});
const replay = (rows: ReplayRow[]) => {
  const seen: Array<{ id: string; priceBalance: number; priceOut: number }> = [];
  const result = replayStockCardMavg(sortRowsForReplay(rows), (item) => seen.push(item));
  return { ...result, seen };
};

describe("negative value-only DN rows (ปรับยอด DN)", () => {
  it("-80 on 4 units worth 400 lowers the average to 80 with no residual", () => {
    const rows = [row("2026-09-30", 1, "PURCHASE", 4, 0, 100), row("2026-09-30", 1, "SUPPLIER_DEBIT", 0, 0, 0, -80, 1)];
    const result = replay(rows);
    assert.equal(result.finalPrice, 80);
    assert.deepEqual(result.residuals, []);
  });

  it("-150 on 4 units worth 100: value stops at 0 and the unabsorbed 50 is a -50 T3 write-off on the DN row", () => {
    const rows = [row("2026-09-30", 1, "PURCHASE", 4, 0, 25), row("2026-09-30", 1, "SUPPLIER_DEBIT", 0, 0, 0, -150, 1),
      row("2026-09-30", 2, "SALE", 0, 1, 0, 0, 1)];
    const result = replay(rows);
    assert.deepEqual(result.residuals.map((item) => [item.source, item.amount]), [["SUPPLIER_DEBIT", -50]]);
    assert.equal(result.seen[1].priceBalance, 0);
    assert.equal(result.seen[2].priceOut, 0, "a later sale takes the zero value, never a negative average");
    assert.equal(result.finalPrice, 0);
  });

  it("positive DN rows are unchanged and never write off", () => {
    const rows = [row("2026-09-30", 1, "PURCHASE", 4, 0, 100), row("2026-09-30", 1, "SUPPLIER_DEBIT", 0, 0, 0, 200, 1)];
    const result = replay(rows);
    assert.equal(result.finalPrice, 150);
    assert.deepEqual(result.residuals, []);
  });

  it("the write-off helper ignores positive rows, sub-satang noise and rows before the T3 start", () => {
    const date = parseDateOnlyToDate("2026-09-30");
    assert.equal(computeDebitValueResidual({ adjustment: -150, newBaTotal: -50, docDate: date }), -50);
    assert.equal(computeDebitValueResidual({ adjustment: 100, newBaTotal: -50, docDate: date }), 0);
    assert.equal(computeDebitValueResidual({ adjustment: -150, newBaTotal: -0.004, docDate: date }), 0);
    assert.equal(computeDebitValueResidual({ adjustment: -150, newBaTotal: -50, docDate: parseDateOnlyToDate("2026-09-29") }), 0);
  });
});

describe("residual facts of a negative DN row survive an appended row's fact rebuild", () => {
  it("rebuildStockValueResidualFactsForProducts carries the DN-row write-off instead of superseding it", async () => {
    const { rebuildStockValueResidualFactsForProducts } = await import("@/lib/profit-fact");
    const dnFact = { sourceId: "sku", sourceSubtype: "SUPPLIER_DEBIT", sourceLineId: "card-dn", businessDate: parseDateOnlyToDate("2026-09-30"),
      costAmount: D(-50) };
    const writes: unknown[] = [];
    const tx = {
      stockCard: { findMany: async () => [] },
      factProfit: { findMany: async () => [dnFact], updateMany: async (args: unknown) => { writes.push(args); return { count: 1 }; } },
    } as unknown as Parameters<typeof rebuildStockValueResidualFactsForProducts>[0];
    await rebuildStockValueResidualFactsForProducts(tx, ["sku"], parseDateOnlyToDate("2026-09-30"));
    assert.deepEqual(writes, [], "the active DN-row fact matches what is carried over, so nothing is superseded");
  });
});
