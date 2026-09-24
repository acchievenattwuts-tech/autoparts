import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getAdjustmentLineLotError } from "../adjustment-lot-guard";

// Server-side lot guard for stock adjustments: a tracked lot-controlled product must
// always name its lots, otherwise StockCard moves but ProductLot / LotBalance do not.

const EMPTY_LOTS_ERROR = "กรุณาระบุ Lot อย่างน้อย 1 รายการ";
const lot = (lotNo: string, qty: number, expDate = "") => ({ lotNo, qty, unitCost: 50, mfgDate: "", expDate });
const guardLine = (overrides: Partial<Parameters<typeof getAdjustmentLineLotError>[0]> = {}) => ({
  isTracked: true,
  isLotControl: true,
  requireExpiryDate: false,
  type: "ADJUST_IN" as const,
  lotItems: [],
  qty: 2,
  ...overrides,
});

test("tracked lot-controlled adjustment line with no lots is rejected, IN and OUT", () => {
  assert.equal(getAdjustmentLineLotError(guardLine()), EMPTY_LOTS_ERROR);
  assert.equal(getAdjustmentLineLotError(guardLine({ type: "ADJUST_OUT" })), EMPTY_LOTS_ERROR);
});

test("tracked lot-controlled adjustment line still runs the full lot validation", () => {
  assert.match(getAdjustmentLineLotError(guardLine({ lotItems: [lot("L1", 1)] })) ?? "", /ไม่ตรงกับจำนวนในบรรทัด/);
  assert.equal(getAdjustmentLineLotError(guardLine({ lotItems: [lot(" ", 2)] })), "กรุณากรอกเลขที่ Lot");
  assert.equal(getAdjustmentLineLotError(guardLine({ lotItems: [lot("L1", 1), lot("L1", 1)] })), "เลขที่ Lot ซ้ำกัน");
  assert.equal(getAdjustmentLineLotError(guardLine({ lotItems: [lot("L1", 1), lot("L2", 1)] })), null);
});

test("the product's EXP requirement applies to ADJUST_IN lots only", () => {
  const needsExp = { requireExpiryDate: true, lotItems: [lot("L1", 2)] };
  assert.match(getAdjustmentLineLotError(guardLine(needsExp)) ?? "", /กรุณากรอกวันหมดอายุ \(EXP\)/);
  assert.equal(
    getAdjustmentLineLotError(guardLine({ requireExpiryDate: true, lotItems: [lot("L1", 2, "2027-01-31")] })),
    null,
  );
  assert.equal(getAdjustmentLineLotError(guardLine({ ...needsExp, type: "ADJUST_OUT" })), null);
});

test("adjustment lines that are not lot-controlled or not stock-tracked are untouched", () => {
  assert.equal(getAdjustmentLineLotError(guardLine({ isLotControl: false })), null);
  assert.equal(getAdjustmentLineLotError(guardLine({ isTracked: false })), null);
});

test("createAdjustment runs the guard before the header insert and throws it as a user error", () => {
  const source = readFileSync(join(process.cwd(), "app/admin/(protected)/stock/adjustments/actions.ts"), "utf8");
  const create = source.slice(source.indexOf("export async function createAdjustment("));
  assert.ok(create.indexOf("getAdjustmentLineLotError(") > 0);
  assert.ok(create.indexOf("getAdjustmentLineLotError(") < create.indexOf("tx.adjustment.create("));
  assert.match(create, /if \(lotError\) throw new AdjustmentUserError\(lotError\);/);
  assert.doesNotMatch(create, /inputItem\.lotItems\.length > 0/);
});

test("AdjustmentForm always shows the lot section and blocks submit through the same guard", () => {
  const source = readFileSync(join(process.cwd(), "app/admin/(protected)/stock/adjustments/AdjustmentForm.tsx"), "utf8");
  assert.doesNotMatch(source, /isLotControl && item\.lotItems\.length > 0/);
  assert.doesNotMatch(source, /product\?\.isLotControl && item\.lotItems\.length > 0/);
  const submit = source.slice(source.indexOf("const handleSubmit"), source.indexOf("startTransition(async"));
  assert.match(submit, /getAdjustmentLineLotError\(/);
  // Auto-allocate with no lot stock keeps the rows and shows the no-stock message instead.
  assert.match(source, /if \(allocated\.length === 0\) return;/);
  assert.match(source, /\{NO_LOT_STOCK_MESSAGE\}/);
});

// ── createAdjustment with the DB, auth and lot writes module-mocked ──

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type ProductStub = { inventoryTracking: string; isLotControl: boolean; requireExpiryDate: boolean };

const calls: string[] = [];
const lotWrites: { direction: string; lots: unknown }[] = [];
let product: ProductStub = { inventoryTracking: "TRACKED", isLotControl: true, requireExpiryDate: false };

const tx = {
  $executeRaw: async () => 0,
  productUnit: { findMany: async () => [{ productId: "p1", name: "ชิ้น", scale: 1 }] },
  product: { findMany: async () => [{ id: "p1", avgCost: 10, ...product }] },
  adjustment: {
    findFirst: async () => null,
    create: async (args: { data: { items: { create: { productId: string; qtyAdjust: number; lineNo: number }[] } } }) => {
      calls.push("adjustment.create");
      return {
        id: "adj-1",
        items: args.data.items.create.map((item, idx) => ({ id: `ai-${idx}`, reason: null, ...item })),
      };
    },
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
      writeStockCard: async () => {
        calls.push("writeStockCard");
        return "sc-1";
      },
      recalculateStockCard: async () => undefined,
      recalculateStockCardMany: async () => undefined,
    },
  });
  await mock.module("@/lib/lot-control", {
    namedExports: {
      getLotAvailability: async () => [],
      writeAdjustmentLots: async (_tx: unknown, _id: string, _productId: string, lots: unknown, direction: string) => {
        calls.push("writeAdjustmentLots");
        lotWrites.push({ direction, lots });
      },
      reverseAdjustmentLotBalance: async () => undefined,
    },
  });
});

beforeEach(() => {
  calls.length = 0;
  lotWrites.length = 0;
  product = { inventoryTracking: "TRACKED", isLotControl: true, requireExpiryDate: false };
});

const adjustForm = (type: "ADJUST_IN" | "ADJUST_OUT", lotItems: ReturnType<typeof lot>[]) => {
  const formData = new FormData();
  formData.set("adjustDate", "2026-09-24");
  formData.set("items", JSON.stringify([{ productId: "p1", unitName: "ชิ้น", qty: 2, price: 50, type, lotItems }]));
  return formData;
};

test(
  "createAdjustment rejects a tracked lot-controlled line without lots, IN and OUT, before any write",
  { skip: moduleMocksUnavailable },
  async () => {
    const { createAdjustment } = await import("../actions");
    for (const type of ["ADJUST_IN", "ADJUST_OUT"] as const) {
      calls.length = 0;
      assert.deepEqual(await createAdjustment(adjustForm(type, [])), { error: EMPTY_LOTS_ERROR }, type);
      assert.deepEqual(calls, [], type);
    }
  },
);

test(
  "createAdjustment enforces the product's EXP requirement on ADJUST_IN before any write",
  { skip: moduleMocksUnavailable },
  async () => {
    product = { ...product, requireExpiryDate: true };
    const { createAdjustment } = await import("../actions");

    assert.deepEqual(await createAdjustment(adjustForm("ADJUST_IN", [lot("L1", 2)])), {
      error: "Lot L1: กรุณากรอกวันหมดอายุ (EXP)",
    });
    assert.deepEqual(calls, []);

    // Stock going out does not need an EXP date.
    const out = await createAdjustment(adjustForm("ADJUST_OUT", [lot("L1", 2)]));
    assert.equal(out.success, true);
  },
);

test(
  "createAdjustment writes lots for a lot-controlled line that names them, in the line's direction",
  { skip: moduleMocksUnavailable },
  async () => {
    const { createAdjustment } = await import("../actions");
    for (const [type, direction] of [["ADJUST_IN", "in"], ["ADJUST_OUT", "out"]] as const) {
      calls.length = 0;
      lotWrites.length = 0;
      const result = await createAdjustment(adjustForm(type, [lot("L1", 2)]));
      assert.equal(result.success, true, type);
      assert.deepEqual(calls, ["adjustment.create", "writeStockCard", "writeAdjustmentLots"], type);
      assert.equal(lotWrites[0].direction, direction);
    }
  },
);

test(
  "createAdjustment leaves non-lot-controlled lines alone: no lots required, none written",
  { skip: moduleMocksUnavailable },
  async () => {
    product = { ...product, isLotControl: false };
    const { createAdjustment } = await import("../actions");
    const result = await createAdjustment(adjustForm("ADJUST_OUT", []));
    assert.equal(result.success, true);
    assert.deepEqual(calls, ["adjustment.create", "writeStockCard"]);
  },
);
