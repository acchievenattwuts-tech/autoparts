import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

import { LotStockInsufficientError } from "@/lib/lot-stock-error";

// A purchase-return lot short on stock must reach the user as the lot's Thai
// message — without a critical alert — while any other failure still gets the
// generic message and a critical report. The shortage used to be recognised by
// matching the message text; it is now the typed LotStockInsufficientError.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

const GENERIC_ERROR = "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง";
let lotWriteError: Error = new Error("unset");
const criticalReports: unknown[] = [];

const tx = {
  productUnit: { findMany: async () => [{ productId: "p1", name: "ชิ้น", scale: 1 }] },
  product: {
    findMany: async () => [
      { id: "p1", avgCost: 10, costPrice: 10, inventoryTracking: "TRACKED", isLotControl: true },
    ],
  },
  purchaseReturn: { create: async () => ({ id: "pr-1" }) },
  purchaseReturnItem: { create: async () => ({ id: "pri-1" }) },
};

before(async () => {
  if (moduleMocksUnavailable) return;
  await mock.module("@/lib/db", {
    namedExports: {
      db: { purchaseReturn: { findFirst: async () => null } },
      dbTx: async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx),
    },
  });
  await mock.module("@/lib/require-auth", {
    namedExports: { requirePermission: async () => ({ user: { id: "u1" } }) },
  });
  await mock.module("next/cache", {
    namedExports: {
      revalidatePath: () => undefined,
      revalidateTag: () => undefined,
      // Imported transitively (lib modules cache reads); never reached before the lot write.
      unstable_cache: <T>(fn: T) => fn,
    },
  });
  await mock.module("@/lib/audit-log", {
    namedExports: {
      diffEntity: () => ({ before: {}, after: {} }),
      getAuditActorFromSession: () => ({}),
      getRequestContext: async () => ({}),
      safeWriteAuditLog: async () => undefined,
    },
  });
  await mock.module("@/lib/error-reporting", {
    namedExports: {
      reportCriticalError: async (error: unknown) => {
        criticalReports.push(error);
      },
    },
  });
  await mock.module("@/lib/stock-card", {
    namedExports: {
      writeStockCard: async () => "sc-1",
      recalculateStockCard: async () => undefined,
    },
  });
  await mock.module("@/lib/lot-control", {
    namedExports: {
      getLotAvailability: async () => [],
      reversePurchaseReturnLotBalance: async () => undefined,
      validateLotRows: () => null,
      writePurchaseReturnLots: async () => {
        throw lotWriteError;
      },
      writeStockMovementLots: async () => undefined,
    },
  });
});

beforeEach(() => {
  criticalReports.length = 0;
});

const returnForm = () => {
  const formData = new FormData();
  formData.set("returnDate", "2026-09-24");
  formData.set("supplierId", "s1");
  formData.set("settlementType", "SUPPLIER_CREDIT");
  formData.set(
    "items",
    JSON.stringify([
      {
        productId: "p1",
        unitName: "ชิ้น",
        qty: 5,
        costPrice: 10,
        lotItems: [{ lotNo: "L1", qty: 5, unitCost: 10, mfgDate: "", expDate: "" }],
      },
    ]),
  );
  return formData;
};

test("createPurchaseReturn returns the lot shortage message without a critical alert", { skip: moduleMocksUnavailable }, async () => {
  const { createPurchaseReturn } = await import("../actions");
  lotWriteError = new LotStockInsufficientError({ productId: "p1", lotNo: "L1", requestedQty: 5, availableQty: 1 });
  assert.deepEqual(await createPurchaseReturn(returnForm()), { error: "Lot L1 คงเหลือไม่พอสำหรับการตัดสต็อก" });
  assert.equal(criticalReports.length, 0);
});

test("createPurchaseReturn keeps unexpected lot-write failures generic and reported", { skip: moduleMocksUnavailable }, async () => {
  const { createPurchaseReturn } = await import("../actions");
  // Same text as the shortage, but not the typed error: no longer trusted as user-facing.
  lotWriteError = new Error("Lot L1 คงเหลือไม่พอสำหรับการตัดสต็อก");
  assert.deepEqual(await createPurchaseReturn(returnForm()), { error: GENERIC_ERROR });
  assert.equal(criticalReports.length, 1);
});
