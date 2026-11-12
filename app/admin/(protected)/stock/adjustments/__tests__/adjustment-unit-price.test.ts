import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

import { getAdjustmentUnitScale, rescaleAdjustmentUnitPrice } from "../adjustment-unit-price";

/**
 * I4 (review 2026-11-12): "ราคา/หน่วย" on an adjustment line is the price per the unit chosen on the
 * line (owner). The StockCard row now stores it per base unit (÷ scale), the same cost the lot row
 * already got; a base-unit line stores the price as before. In the form, a price follows the unit
 * the line switches to; a line that stays in the base unit keeps its price.
 */
const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" && "requires --experimental-test-module-mocks";

type StockCardInput = { productId: string; qtyIn: number; qtyOut: number; priceIn: number };
type LotInBase = { lotNo: string; qtyInBase: number; unitCostBase: number };

const stockCards: StockCardInput[] = [];
const lotWrites: Array<{ productId: string; lots: LotInBase[] }> = [];

const UNITS = [
  { productId: "p-lot", name: "ชิ้น", scale: 1 },
  { productId: "p-lot", name: "กล่อง", scale: 10 },
  { productId: "p-plain", name: "ชิ้น", scale: 1 },
  { productId: "p-plain", name: "กล่อง", scale: 10 },
];

const tx = {
  $queryRaw: async () => [],
  $executeRaw: async () => 0,
  profitDistribution: { findMany: async () => [] },
  productUnit: { findMany: async () => UNITS },
  product: {
    findMany: async () => [
      { id: "p-lot", inventoryTracking: "TRACKED", isLotControl: true, requireExpiryDate: false, avgCost: 90 },
      { id: "p-plain", inventoryTracking: "TRACKED", isLotControl: false, requireExpiryDate: false, avgCost: 45 },
    ],
  },
  adjustment: {
    findFirst: async () => null,
    create: async (args: { data: { items: { create: Array<{ productId: string; qtyAdjust: number }> } } }) => ({
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
      writeStockCard: async (_tx: unknown, input: StockCardInput) => {
        stockCards.push(input);
        return `sc-${stockCards.length}`;
      },
      recalculateStockCard: async () => undefined,
      recalculateStockCardMany: async () => undefined,
    },
  });
  await mock.module("@/lib/lot-control", {
    namedExports: {
      getLotAvailability: async () => [],
      writeAdjustmentLots: async (_tx: unknown, _stockCardId: string, productId: string, lots: LotInBase[]) => {
        lotWrites.push({ productId, lots });
      },
      reverseAdjustmentLotBalance: async () => undefined,
      validateLotRows: () => null,
    },
  });
});

beforeEach(() => {
  stockCards.length = 0;
  lotWrites.length = 0;
});

const adjustForm = (items: unknown[]): FormData => {
  const formData = new FormData();
  formData.set("adjustDate", "2026-11-12");
  formData.set("items", JSON.stringify(items));
  return formData;
};

const lot = (unitCost: number) => ({ lotNo: "L1", qty: 1, unitCost, mfgDate: "", expDate: "" });

test("1 box (scale 10) at 1,000: StockCard priceIn is 100 per piece, the same as the lot unit cost", { skip: moduleMocksUnavailable }, async () => {
  const { createAdjustment } = await import("../actions");
  const result = await createAdjustment(adjustForm([
    { productId: "p-lot", unitName: "กล่อง", qty: 1, price: 1000, type: "ADJUST_IN", lotItems: [lot(1000)] },
  ]));
  assert.equal(result.success, true);
  assert.deepEqual(stockCards.map(({ qtyIn, priceIn }) => ({ qtyIn, priceIn })), [{ qtyIn: 10, priceIn: 100 }]);
  assert.equal(lotWrites[0].lots[0].unitCostBase, 100);
  assert.equal(stockCards[0].priceIn, lotWrites[0].lots[0].unitCostBase);
});

test("a box line without lots stores the box price per piece", { skip: moduleMocksUnavailable }, async () => {
  const { createAdjustment } = await import("../actions");
  await createAdjustment(adjustForm([
    { productId: "p-plain", unitName: "กล่อง", qty: 2, price: 450, type: "ADJUST_IN", lotItems: [] },
  ]));
  assert.deepEqual(stockCards.map(({ qtyIn, priceIn }) => ({ qtyIn, priceIn })), [{ qtyIn: 20, priceIn: 45 }]);
});

test("base-unit lines store the same priceIn as before (price as keyed)", { skip: moduleMocksUnavailable }, async () => {
  const { createAdjustment } = await import("../actions");
  const items = [
    { productId: "p-plain", unitName: "ชิ้น", qty: 3, price: 45, type: "ADJUST_IN", lotItems: [] },
    { productId: "p-plain", unitName: "ชิ้น", qty: 1, price: 12.34, type: "ADJUST_OUT", lotItems: [] },
    { productId: "p-lot", unitName: "ชิ้น", qty: 1, price: 95.5, type: "ADJUST_IN", lotItems: [lot(0)] },
  ];
  await createAdjustment(adjustForm(items));
  // Before I4 the StockCard row took `price` as keyed; for scale 1 the new value is identical.
  assert.deepEqual(stockCards.map((card) => card.priceIn), items.map((item) => item.price));
  assert.deepEqual(stockCards.map(({ qtyIn, qtyOut }) => ({ qtyIn, qtyOut })), [
    { qtyIn: 3, qtyOut: 0 }, { qtyIn: 0, qtyOut: 1 }, { qtyIn: 1, qtyOut: 0 },
  ]);
  assert.equal(lotWrites[0].lots[0].unitCostBase, 95.5, "lot cost falls back to the line price per piece, as before");
});

test("form: the price follows the chosen unit and stays put for the base unit", () => {
  const units = [{ name: "ชิ้น", scale: 1 }, { name: "กล่อง", scale: 10 }, { name: "โหล", scale: 12 }];
  // No unit chosen yet = base unit, so picking the base unit changes nothing.
  assert.equal(getAdjustmentUnitScale(units, ""), 1);
  assert.equal(rescaleAdjustmentUnitPrice(45, getAdjustmentUnitScale(units, ""), getAdjustmentUnitScale(units, "ชิ้น")), 45);
  // Default cost 45 per piece → 450 per box, and back.
  assert.equal(rescaleAdjustmentUnitPrice(45, 1, 10), 450);
  assert.equal(rescaleAdjustmentUnitPrice(450, 10, 1), 45);
  assert.equal(rescaleAdjustmentUnitPrice(1000, 12, 1), 83.33);
  assert.equal(rescaleAdjustmentUnitPrice(0, 1, 10), 0);
});
