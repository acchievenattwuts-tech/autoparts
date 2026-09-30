import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

type AuditEntry = { action: string; entityRef?: string; meta?: { recalculatedCount?: number; failedProductIds?: string[] } };

const products = Array.from({ length: 150 }, (_, index) => ({ id: `p-${index + 1}`, code: `CODE-${index + 1}` }));
/** A DN replay on a SKU whose stock went non-positive throws inside recalculateStockCardMany. */
let failing = new Set<string>();
let allowed = true;
let transactions: string[][] = [];
let audits: AuditEntry[] = [];
let revalidated: string[] = [];
let recalculateAllStockCards: typeof import("../actions").recalculateAllStockCards;

before(async () => {
  await mock.module("@/lib/require-auth", { namedExports: {
    requirePermission: async () => {
      if (!allowed) throw new Error("FORBIDDEN");
      return { user: { id: "admin-1", name: "Admin" } };
    },
  } });
  await mock.module("@/lib/audit-log", { namedExports: {
    getAuditActorFromSession: () => ({ actorId: "admin-1" }),
    getRequestContext: async () => ({}),
    safeWriteAuditLog: async (entry: AuditEntry) => { audits.push(entry); },
  } });
  await mock.module("@/lib/db", { namedExports: {
    db: { product: { findMany: async () => products } },
    dbTx: async (callback: (tx: object) => Promise<void>) => callback({}),
  } });
  await mock.module("@/lib/stock-card", { namedExports: {
    recalculateStockCardMany: async (_tx: object, productIds: string[]) => {
      transactions.push(productIds);
      const bad = productIds.find((id) => failing.has(id));
      if (bad) throw new Error("DN inventory adjustment requires positive stock");
    },
  } });
  await mock.module("next/cache", { namedExports: { revalidatePath: (path: string) => { revalidated.push(path); } } });
  ({ recalculateAllStockCards } = await import("../actions"));
});

beforeEach(() => { failing = new Set(); allowed = true; transactions = []; audits = []; revalidated = []; });

describe("stock card: recalculate all continues past a failing product (D15)", () => {
  it("all products succeed in two batched transactions", async () => {
    assert.deepEqual(await recalculateAllStockCards(), { success: true, count: 150 });
    assert.deepEqual(transactions.map((batch) => batch.length), [100, 50]);
    assert.equal(audits.length, 1);
    assert.deepEqual(revalidated, ["/admin/stock/card"]);
  });

  it("a failing SKU is isolated, the rest are recalculated and the summary names its code", async () => {
    failing = new Set(["p-7", "p-120"]);
    const result = await recalculateAllStockCards();
    assert.equal(result.success, false);
    assert.equal(result.count, 148);
    assert.match(result.error ?? "", /คำนวณไม่สำเร็จ 2 สินค้า: CODE-7, CODE-120/);
    // Both batches failed as a whole, then every product was retried alone; later batches still ran.
    assert.equal(transactions.filter((batch) => batch.length === 1).length, 150);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].meta?.recalculatedCount, 148);
    assert.deepEqual(audits[0].meta?.failedProductIds, ["p-7", "p-120"]);
  });

  it("more than 20 failures lists 20 codes and counts the rest", async () => {
    failing = new Set(products.slice(0, 25).map((product) => product.id));
    const result = await recalculateAllStockCards();
    assert.match(result.error ?? "", /คำนวณไม่สำเร็จ 25 สินค้า: .*CODE-20 และอีก 5 รายการ/);
    assert.doesNotMatch(result.error ?? "", /CODE-21\b/);
    assert.equal(result.count, 125);
  });

  it("when every product fails there is no success count and no audit entry", async () => {
    failing = new Set(products.map((product) => product.id));
    const result = await recalculateAllStockCards();
    assert.equal(result.count, undefined);
    assert.match(result.error ?? "", /คำนวณไม่สำเร็จ 150 สินค้า/);
    assert.equal(audits.length, 0);
  });

  it("permission is still required before any recalculation", async () => {
    allowed = false;
    assert.deepEqual(await recalculateAllStockCards(), { error: "ไม่มีสิทธิ์เข้าถึง" });
    assert.equal(transactions.length, 0);
  });
});
