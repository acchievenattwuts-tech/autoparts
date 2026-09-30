import assert from "node:assert/strict";
import test, { before, mock } from "node:test";
import { Prisma } from "@/lib/generated/prisma";

// ก5: PurchaseItem.quantity is a Prisma Decimal. The purchase-return form and the supplier DN
// form are client components; a Decimal is a class instance React cannot pass from server to
// client, so the loaders must hand over plain numbers only.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

let purchaseRow: unknown = null;

before(async () => {
  if (moduleMocksUnavailable) return;
  const realDb = await import("@/lib/db");
  await mock.module("@/lib/db", {
    namedExports: { ...realDb, db: { purchase: { findUnique: async () => purchaseRow } } },
  });
  const realAuth = await import("@/lib/require-auth");
  await mock.module("@/lib/require-auth", {
    namedExports: {
      ...realAuth,
      requirePermission: async () => ({ user: { id: "user-1", name: "Tester", role: "ADMIN" } }),
    },
  });
});

/** Fails on anything React's server-to-client serialization would reject (class instances such as Decimal). */
function assertClientSerializable(value: unknown, path = "result"): void {
  if (value === null || ["string", "number", "boolean", "undefined"].includes(typeof value)) return;
  if (value instanceof Date) return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertClientSerializable(entry, `${path}[${index}]`));
    return;
  }
  const prototype = Object.getPrototypeOf(value);
  assert.ok(prototype === Object.prototype || prototype === null, `${path} is not a plain object`);
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    assertClientSerializable(entry, `${path}.${key}`);
  }
}

const product = {
  id: "oil-1", code: "OIL-1", name: "น้ำมันเครื่อง", description: null, avgCost: new Prisma.Decimal("150"),
  costPrice: new Prisma.Decimal("150"), inventoryTracking: "TRACKED", isLotControl: false, isActive: true,
  purchaseUnitName: "ลิตร", category: { name: "น้ำมัน" }, brand: null, aliases: [],
  units: [{ name: "ลิตร", scale: new Prisma.Decimal("1"), isBase: true }],
};

test("getPurchaseDetail (purchase-return form) converts Decimal quantities to numbers", { skip: moduleMocksUnavailable }, async () => {
  purchaseRow = {
    items: [
      // A line saved without display fields falls back to the base quantity.
      { productId: "oil-1", quantity: new Prisma.Decimal("20.5000"), costPrice: new Prisma.Decimal("150"), showQty: null,
        showUnitName: null, showPricePerUnit: null, unitScale: null, product, lotItems: [] },
      { productId: "oil-1", quantity: new Prisma.Decimal("24.0000"), costPrice: new Prisma.Decimal("150"),
        showQty: new Prisma.Decimal("2.0000"), showUnitName: "ลัง", showPricePerUnit: new Prisma.Decimal("1800"),
        unitScale: new Prisma.Decimal("12.0000"), product, lotItems: [] },
    ],
  };
  const { getPurchaseDetail } = await import("../../purchase-returns/actions");

  const result = await getPurchaseDetail("purchase-1");

  assert.ok(result);
  assert.deepEqual(result.items.map((item) => item.qty), [20.5, 2]);
  assertClientSerializable(result);
});

test("toDebitPurchase (supplier DN form) converts Decimal quantities to numbers", async () => {
  const { toDebitPurchase } = await import("../../supplier-debit-notes/debit-purchase");

  const result = toDebitPurchase({
    id: "purchase-1", purchaseNo: "RRC26093000001", vatType: "NO_VAT", vatRate: new Prisma.Decimal("0"),
    supplier: { name: "ผู้จำหน่าย" },
    items: [
      { id: "line-1", quantity: new Prisma.Decimal("20.5000"), showQty: null, showUnitName: null, showPricePerUnit: null,
        costPrice: new Prisma.Decimal("150"), product: { code: "OIL-1", name: "น้ำมันเครื่อง" } },
      { id: "line-2", quantity: new Prisma.Decimal("24.0000"), showQty: new Prisma.Decimal("2.0000"), showUnitName: "ลัง",
        showPricePerUnit: new Prisma.Decimal("1800"), costPrice: new Prisma.Decimal("150"), product: { code: "OIL-1", name: "น้ำมันเครื่อง" } },
    ],
  });

  assert.deepEqual(result.items.map((item) => item.quantity), [20.5, 2]);
  assertClientSerializable(result);
});
