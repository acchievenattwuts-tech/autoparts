import assert from "node:assert/strict";
import test from "node:test";

import {
  LotStockInsufficientError as ReExportedLotStockInsufficientError,
  writeAdjustmentLots,
  writePurchaseReturnLots,
  type LotSubRowBase,
} from "@/lib/lot-control";
import { LotStockInsufficientError } from "@/lib/lot-stock-error";

// A lot short on stock used to throw a plain Error, so Server Actions could only
// show the generic "เกิดข้อผิดพลาด". It is now a typed, user-facing error with the
// same Thai message. Lot math and the availability rule are unchanged.

const lot = (lotNo: string, qtyInBase: number): LotSubRowBase => ({
  lotNo,
  qtyInBase,
  unitCostBase: 10,
  mfgDate: null,
  expDate: null,
});

const makeTx = (balances: { lotNo: string; qtyOnHand: number }[]) => {
  const writes: string[] = [];
  const tx = {
    lotBalance: {
      findMany: async () => balances,
      updateMany: async () => {
        writes.push("lotBalance.updateMany");
        return { count: 1 };
      },
      upsert: async () => writes.push("lotBalance.upsert"),
    },
    productLot: { upsert: async () => writes.push("productLot.upsert") },
    stockMovementLot: { create: async () => writes.push("stockMovementLot.create") },
    purchaseReturnItemLot: { create: async () => writes.push("purchaseReturnItemLot.create") },
    $executeRaw: async () => {
      writes.push("$executeRaw");
      return 0;
    },
  };
  return { tx: tx as unknown as Parameters<typeof writeAdjustmentLots>[0], writes };
};

const assertShortage = (error: unknown, lotNo: string, requestedQty: number, availableQty: number) => {
  assert.ok(error instanceof LotStockInsufficientError);
  assert.equal(error.message, `Lot ${lotNo} คงเหลือไม่พอสำหรับการตัดสต็อก`);
  assert.equal(error.productId, "p1");
  assert.equal(error.lotNo, lotNo);
  assert.equal(error.requestedQty, requestedQty);
  assert.equal(error.availableQty, availableQty);
  return true;
};

test("lib/lot-control re-exports the same error class", () => {
  assert.equal(ReExportedLotStockInsufficientError, LotStockInsufficientError);
});

test("writeAdjustmentLots(out) throws LotStockInsufficientError before any lot write", async () => {
  const { tx, writes } = makeTx([{ lotNo: "L1", qtyOnHand: 3 }]);
  await assert.rejects(
    writeAdjustmentLots(tx, "sc-1", "p1", [lot("L1", 2), lot("L1", 2)], "out"),
    (error) => assertShortage(error, "L1", 4, 3),
  );
  assert.deepEqual(writes, []);
});

test("writeAdjustmentLots(out) treats a missing LotBalance row as zero on hand", async () => {
  const { tx } = makeTx([]);
  await assert.rejects(writeAdjustmentLots(tx, "sc-1", "p1", [lot("L9", 1)], "out"), (error) =>
    assertShortage(error, "L9", 1, 0),
  );
});

test("writeAdjustmentLots(out) still deducts when the lot has enough (tolerance unchanged)", async () => {
  const { tx, writes } = makeTx([{ lotNo: "L1", qtyOnHand: 3.99995 }]);
  await writeAdjustmentLots(tx, "sc-1", "p1", [lot("L1", 4)], "out");
  assert.deepEqual(writes, ["lotBalance.updateMany", "$executeRaw", "stockMovementLot.create"]);
});

test("writePurchaseReturnLots throws LotStockInsufficientError before any lot write", async () => {
  const { tx, writes } = makeTx([{ lotNo: "L2", qtyOnHand: 1 }]);
  await assert.rejects(writePurchaseReturnLots(tx, "pri-1", "p1", [lot("L2", 5)]), (error) =>
    assertShortage(error, "L2", 5, 1),
  );
  assert.deepEqual(writes, []);
});
