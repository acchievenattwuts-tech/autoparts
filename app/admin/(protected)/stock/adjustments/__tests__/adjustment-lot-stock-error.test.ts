import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

import { LotStockInsufficientError } from "@/lib/lot-stock-error";

// An ADJUST_OUT line whose lot is short on stock used to surface as the generic
// "เกิดข้อผิดพลาด". createAdjustment now returns the lot's Thai message.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

const GENERIC_ERROR = "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง";
let lotWriteError: Error | null = null;
let lotWrites = 0;

const tx = {
  $executeRaw: async () => 0,
  productUnit: { findMany: async () => [{ productId: "p1", name: "ชิ้น", scale: 1 }] },
  product: {
    findMany: async () => [
      { id: "p1", inventoryTracking: "TRACKED", isLotControl: true, requireExpiryDate: false, avgCost: 10 },
    ],
  },
  adjustment: {
    findFirst: async () => null,
    create: async (args: { data: { items: { create: { productId: string; qtyAdjust: number; lineNo: number }[] } } }) => ({
      id: "adj-1",
      items: args.data.items.create.map((item, idx) => ({ id: `ai-${idx}`, reason: null, ...item })),
    }),
  },
};

before(async () => {
  if (moduleMocksUnavailable) return;
  await mock.module("@/lib/db", {
    namedExports: {
      db: { adjustment: { findUnique: async () => null }, stockCard: { findMany: async () => [] } },
      dbTx: async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx),
    },
  });
  await mock.module("@/lib/require-auth", {
    namedExports: { requirePermission: async () => ({ user: { id: "u1" } }) },
  });
  await mock.module("next/cache", { namedExports: { revalidatePath: () => undefined } });
  await mock.module("@/lib/audit-log", {
    namedExports: {
      diffEntity: () => ({ before: {}, after: {} }),
      getAuditActorFromSession: () => ({}),
      getRequestContext: async () => ({}),
      safeWriteAuditLog: async () => undefined,
    },
  });
  await mock.module("@/lib/stock-card", {
    namedExports: {
      writeStockCard: async () => "sc-1",
      recalculateStockCardMany: async () => undefined,
    },
  });
  await mock.module("@/lib/lot-control", {
    namedExports: {
      getLotAvailability: async () => [],
      reverseAdjustmentLotBalance: async () => undefined,
      writeAdjustmentLots: async () => {
        lotWrites += 1;
        if (lotWriteError) throw lotWriteError;
      },
    },
  });
});

beforeEach(() => {
  lotWriteError = null;
  lotWrites = 0;
});

const outForm = () => {
  const formData = new FormData();
  formData.set("adjustDate", "2026-09-24");
  formData.set(
    "items",
    JSON.stringify([
      {
        productId: "p1",
        unitName: "ชิ้น",
        qty: 5,
        price: 20,
        type: "ADJUST_OUT",
        lotItems: [{ lotNo: "L1", qty: 5, unitCost: 10, mfgDate: "", expDate: "" }],
      },
    ]),
  );
  return formData;
};

test("createAdjustment returns the lot shortage message instead of the generic error", { skip: moduleMocksUnavailable }, async () => {
  const { createAdjustment } = await import("../actions");
  lotWriteError = new LotStockInsufficientError({ productId: "p1", lotNo: "L1", requestedQty: 5, availableQty: 2 });
  const result = await createAdjustment(outForm());
  assert.deepEqual(result, { error: "Lot L1 คงเหลือไม่พอสำหรับการตัดสต็อก" });
  assert.equal(lotWrites, 1);
});

test("createAdjustment still hides unexpected errors behind the generic message", { skip: moduleMocksUnavailable }, async () => {
  const { createAdjustment } = await import("../actions");
  lotWriteError = new Error("connection reset");
  assert.deepEqual(await createAdjustment(outForm()), { error: GENERIC_ERROR });
});

test("createAdjustment succeeds when the lot write passes", { skip: moduleMocksUnavailable }, async () => {
  const { createAdjustment } = await import("../actions");
  const result = await createAdjustment(outForm());
  assert.equal(result.success, true);
  assert.equal(lotWrites, 1);
});
