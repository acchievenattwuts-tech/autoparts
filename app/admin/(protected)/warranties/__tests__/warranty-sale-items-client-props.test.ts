import assert from "node:assert/strict";
import test, { before, mock } from "node:test";
import { Prisma } from "@/lib/generated/prisma";

// E7: SaleItem.quantity is a Prisma Decimal. getSaleItems feeds NewWarrantyForm (a client
// component); a Decimal is a class instance that React cannot pass from server to client, so
// the action must hand over plain numbers only.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

let saleRow: unknown = null;
let failRead = false;

before(async () => {
  if (moduleMocksUnavailable) return;
  const realDb = await import("@/lib/db");
  await mock.module("@/lib/db", {
    namedExports: { ...realDb, db: { sale: { findUnique: async () => {
      if (failRead) throw new Error("connection reset");
      return saleRow;
    } } } },
  });
  const realAuth = await import("@/lib/require-auth");
  await mock.module("@/lib/require-auth", {
    namedExports: {
      ...realAuth,
      requireAnyPermission: async () => ({ user: { id: "user-1", name: "Tester", role: "ADMIN" } }),
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

test("getSaleItems converts Decimal quantities to numbers before they reach the client form", { skip: moduleMocksUnavailable }, async () => {
  saleRow = {
    id: "sale-1",
    saleNo: "SA2609300001",
    saleDate: new Date("2026-09-30T00:00:00Z"),
    customerName: "ลูกค้า",
    items: [
      { id: "item-1", product: { code: "OIL-1", name: "น้ำมันเครื่อง" }, quantity: new Prisma.Decimal("0.4000"), warranties: [] },
      { id: "item-2", product: { code: "FLT-1", name: "ไส้กรอง" }, quantity: new Prisma.Decimal("2.0000"), warranties: [{ id: "w-1" }] },
    ],
  };
  const { getSaleItems } = await import("../actions");

  const result = await getSaleItems("sale-1");

  assert.ok(result);
  assert.deepEqual(result.items.map((item) => item.quantity), [0.4, 2]);
  assertClientSerializable(result);
  assert.throws(() => assertClientSerializable(saleRow), /not a plain object/, "the helper does catch a raw Decimal");
});

test("getSaleItems returns null for a missing sale or a failed read", { skip: moduleMocksUnavailable }, async () => {
  const { getSaleItems } = await import("../actions");
  saleRow = null;
  assert.equal(await getSaleItems("missing"), null);

  const spy = mock.method(console, "error", () => undefined);
  try {
    failRead = true;
    assert.equal(await getSaleItems("sale-1"), null);
  } finally {
    failRead = false;
    spy.mock.restore();
  }
});
