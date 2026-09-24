import assert from "node:assert/strict";
import test from "node:test";

import { Prisma } from "@/lib/generated/prisma";
import {
  reverseAdjustmentLotBalance,
  reverseBalanceForwardLotBalance,
  writeBalanceForwardLots,
  writePurchaseLots,
  writeStockMovementLots,
  type LotSubRowBase,
} from "@/lib/lot-control";

// Review item #7: a Balance Forward used to call writePurchaseLots(tx, bf.id, ...),
// which inserts a PurchaseItemLot whose purchaseItemId has a real FK to
// PurchaseItem — so every BF of a lot-controlled product rolled back. These tests
// drive the lot helpers against an in-memory transaction to prove the BF path
// never touches PurchaseItemLot, still books ProductLot/LotBalance, and that
// cancel restores LotBalance from the BF StockCard's StockMovementLot rows.

type Decimal = Prisma.Decimal;
const D = (value: number | string) => new Prisma.Decimal(value);
const key = (productId: string, lotNo: string) => `${productId}|${lotNo}`;

interface ProductLotRow {
  productId: string;
  lotNo: string;
  purchaseItemId: string | null;
  unitCost: Decimal;
  mfgDate: Date | null;
  expDate: Date | null;
}
interface StockCardRow { id: string; productId: string; source: string; referenceId: string | null }
interface MovementRow { stockCardId: string; lotNo: string; qtyIn: Decimal; qtyOut: Decimal; unitCost: Decimal }
interface UpsertArgs<T> {
  where: { productId_lotNo: { productId: string; lotNo: string } };
  create: T;
  update: Record<string, unknown>;
}
interface StockCardWhere { referenceId: string; source?: string; productId?: string | { in: string[] } }

const createFakeTx = () => {
  const productLots = new Map<string, ProductLotRow>();
  const lotBalances = new Map<string, Decimal>();
  const stockCards: StockCardRow[] = [];
  const movements: MovementRow[] = [];
  const purchaseItemLots: unknown[] = [];

  const matchesProduct = (filter: StockCardWhere["productId"], productId: string) =>
    filter === undefined || (typeof filter === "string" ? filter === productId : filter.in.includes(productId));

  const tx = {
    productLot: {
      upsert: async ({ where, create, update }: UpsertArgs<ProductLotRow>) => {
        const k = key(where.productId_lotNo.productId, where.productId_lotNo.lotNo);
        const existing = productLots.get(k);
        if (!existing) {
          productLots.set(k, { ...create, purchaseItemId: create.purchaseItemId ?? null });
        } else if (update.expDate !== undefined) {
          existing.expDate = update.expDate as Date | null;
        }
      },
    },
    lotBalance: {
      upsert: async ({ where, create, update }: UpsertArgs<{ qtyOnHand: Decimal }>) => {
        const k = key(where.productId_lotNo.productId, where.productId_lotNo.lotNo);
        const existing = lotBalances.get(k);
        const increment = (update.qtyOnHand as { increment: Decimal }).increment;
        lotBalances.set(k, existing ? existing.add(increment) : new Prisma.Decimal(create.qtyOnHand));
      },
      updateMany: async ({ where, data }: { where: { productId: string; lotNo: string }; data: { qtyOnHand: { decrement: Decimal } } }) => {
        const k = key(where.productId, where.lotNo);
        const existing = lotBalances.get(k);
        if (!existing) return { count: 0 };
        lotBalances.set(k, existing.sub(data.qtyOnHand.decrement));
        return { count: 1 };
      },
    },
    // Only the LotBalance clamp statement is issued: values = [productId, lotNo].
    $executeRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      const k = key(String(values[0]), String(values[1]));
      const existing = lotBalances.get(k);
      if (existing && existing.lessThan(0)) lotBalances.set(k, D(0));
      return existing ? 1 : 0;
    },
    purchaseItemLot: {
      create: async (args: unknown) => {
        purchaseItemLots.push(args);
      },
    },
    stockMovementLot: {
      create: async ({ data }: { data: MovementRow }) => {
        movements.push(data);
      },
    },
    stockCard: {
      findMany: async ({ where }: { where: StockCardWhere }) =>
        stockCards
          .filter((sc) =>
            sc.referenceId === where.referenceId &&
            (where.source === undefined || sc.source === where.source) &&
            matchesProduct(where.productId, sc.productId))
          .map((sc) => ({
            productId: sc.productId,
            lotMovements: movements
              .filter((m) => m.stockCardId === sc.id)
              .map((m) => ({ lotNo: m.lotNo, qtyIn: m.qtyIn, qtyOut: m.qtyOut })),
          })),
    },
  };

  return {
    tx: tx as unknown as Parameters<typeof writeBalanceForwardLots>[0],
    productLots,
    lotBalances,
    stockCards,
    movements,
    purchaseItemLots,
  };
};

const lot = (lotNo: string, qtyInBase: number, unitCostBase = 10): LotSubRowBase => ({
  lotNo,
  qtyInBase,
  unitCostBase,
  mfgDate: null,
  expDate: new Date("2027-01-31T17:00:00.000Z"),
});

const balanceOf = (fake: ReturnType<typeof createFakeTx>, lotNo: string, productId = "p1") =>
  fake.lotBalances.get(key(productId, lotNo))?.toString();

test("writeBalanceForwardLots books ProductLot + LotBalance and never creates a PurchaseItemLot", async () => {
  const fake = createFakeTx();

  await writeBalanceForwardLots(fake.tx, "p1", [lot("L1", 24, 1.25), lot("L2", 6, 2)]);

  assert.equal(fake.purchaseItemLots.length, 0);
  assert.equal(balanceOf(fake, "L1"), "24");
  assert.equal(balanceOf(fake, "L2"), "6");
  const l1 = fake.productLots.get(key("p1", "L1"));
  assert.ok(l1);
  assert.equal(l1.purchaseItemId, null);
  assert.equal(l1.unitCost.toString(), "1.25");
  assert.equal(l1.expDate?.toISOString(), "2027-01-31T17:00:00.000Z");
});

test("writeBalanceForwardLots on an existing lot increments LotBalance and keeps the first unitCost", async () => {
  const fake = createFakeTx();
  await writePurchaseLots(fake.tx, "pi-1", "p1", [lot("L1", 5, 3)]);

  await writeBalanceForwardLots(fake.tx, "p1", [lot("L1", 7, 99)]);

  assert.equal(balanceOf(fake, "L1"), "12");
  const l1 = fake.productLots.get(key("p1", "L1"));
  assert.equal(l1?.unitCost.toString(), "3");
  assert.equal(l1?.purchaseItemId, "pi-1");
  assert.equal(fake.purchaseItemLots.length, 1, "only the real purchase line writes a PurchaseItemLot");
});

test("writePurchaseLots still writes ProductLot(purchaseItemId) + LotBalance + PurchaseItemLot", async () => {
  const fake = createFakeTx();

  await writePurchaseLots(fake.tx, "pi-9", "p1", [lot("L9", 4, 2.5)]);

  assert.equal(balanceOf(fake, "L9"), "4");
  assert.equal(fake.productLots.get(key("p1", "L9"))?.purchaseItemId, "pi-9");
  assert.deepEqual(fake.purchaseItemLots, [{
    data: {
      purchaseItemId: "pi-9",
      lotNo: "L9",
      qty: D(4),
      unitCost: D(2.5),
      mfgDate: null,
      expDate: new Date("2027-01-31T17:00:00.000Z"),
    },
  }]);
});

test("cancel: reverseBalanceForwardLotBalance restores LotBalance from the BF StockCard lot movements", async () => {
  const fake = createFakeTx();
  // Pre-existing stock of L1 from a purchase.
  await writePurchaseLots(fake.tx, "pi-1", "p1", [lot("L1", 5)]);
  // Another document's movement on the same lot, with an unrelated referenceId.
  fake.stockCards.push({ id: "sc-adj", productId: "p1", source: "ADJUST_IN", referenceId: "adj-1" });
  await writeStockMovementLots(fake.tx, "sc-adj", [lot("L1", 100)], "in");

  // createBF: StockCard row (source BF, referenceId = bf.id) + lot bookkeeping.
  const bfLots = [lot("L1", 24), lot("L2", 6)];
  fake.stockCards.push({ id: "sc-bf", productId: "p1", source: "BF", referenceId: "bf-1" });
  await writeBalanceForwardLots(fake.tx, "p1", bfLots);
  await writeStockMovementLots(fake.tx, "sc-bf", bfLots, "in");
  assert.equal(balanceOf(fake, "L1"), "29");
  assert.equal(balanceOf(fake, "L2"), "6");

  await reverseBalanceForwardLotBalance(fake.tx, "bf-1", "p1");

  assert.equal(balanceOf(fake, "L1"), "5", "only the BF quantity is removed");
  assert.equal(balanceOf(fake, "L2"), "0");
  assert.equal(fake.purchaseItemLots.length, 1);
});

test("cancel: reverseBalanceForwardLotBalance clamps at 0 when the BF lot was already consumed", async () => {
  const fake = createFakeTx();
  fake.stockCards.push({ id: "sc-bf", productId: "p1", source: "BF", referenceId: "bf-1" });
  await writeBalanceForwardLots(fake.tx, "p1", [lot("L1", 10)]);
  await writeStockMovementLots(fake.tx, "sc-bf", [lot("L1", 10)], "in");
  fake.lotBalances.set(key("p1", "L1"), D(3)); // 7 sold since

  await reverseBalanceForwardLotBalance(fake.tx, "bf-1", "p1");

  assert.equal(balanceOf(fake, "L1"), "0");
});

test("cancel: reverseBalanceForwardLotBalance ignores non-BF rows sharing the referenceId and other products", async () => {
  const fake = createFakeTx();
  fake.lotBalances.set(key("p1", "L1"), D(50));
  fake.lotBalances.set(key("p2", "L1"), D(50));
  fake.stockCards.push({ id: "sc-x", productId: "p1", source: "ADJUST_IN", referenceId: "bf-1" });
  fake.stockCards.push({ id: "sc-y", productId: "p2", source: "BF", referenceId: "bf-1" });
  await writeStockMovementLots(fake.tx, "sc-x", [lot("L1", 10)], "in");
  await writeStockMovementLots(fake.tx, "sc-y", [lot("L1", 10)], "in");

  await reverseBalanceForwardLotBalance(fake.tx, "bf-1", "p1");

  assert.equal(balanceOf(fake, "L1", "p1"), "50");
  assert.equal(balanceOf(fake, "L1", "p2"), "50");
});

test("reverseAdjustmentLotBalance keeps its behaviour after sharing the reversal loop", async () => {
  const fake = createFakeTx();
  fake.lotBalances.set(key("p1", "L1"), D(20));
  fake.lotBalances.set(key("p1", "L2"), D(1));
  fake.stockCards.push({ id: "sc-in", productId: "p1", source: "ADJUST_IN", referenceId: "adj-1" });
  fake.stockCards.push({ id: "sc-out", productId: "p1", source: "ADJUST_OUT", referenceId: "adj-1" });
  await writeStockMovementLots(fake.tx, "sc-in", [lot("L1", 8)], "in");
  await writeStockMovementLots(fake.tx, "sc-out", [lot("L2", 4), lot("L3", 2)], "out");

  await reverseAdjustmentLotBalance(fake.tx, "adj-1", ["p1"]);

  assert.equal(balanceOf(fake, "L1"), "12");
  assert.equal(balanceOf(fake, "L2"), "5");
  assert.equal(balanceOf(fake, "L3"), "2", "a missing LotBalance row is re-created by the upsert");
});
