import assert from "node:assert/strict";
import test from "node:test";

import { Prisma } from "@/lib/generated/prisma";

import {
  aggregatePurchaseLotDecrements,
  reversePurchaseLotBalancesBatch,
  type PurchaseItemLotRow,
  type PurchaseLotReversalItem,
} from "../purchase-lot-reversal";

// cancelPurchase used to call reversePurchaseLotBalance() once per purchase line:
// for each lot row, `qtyOnHand -= qty` then `qtyOnHand = GREATEST(qtyOnHand, 0)`.
// The batch helper instead runs one `GREATEST(qtyOnHand - Σqty, 0)` per (product, lot).
// These tests prove both produce the same LotBalance for any non-negative lot qty.

type Balances = Map<string, Prisma.Decimal>;
const key = (productId: string, lotNo: string) => `${productId}|${lotNo}`;
const ZERO = new Prisma.Decimal(0);
const clampZero = (value: Prisma.Decimal) => (value.lessThan(0) ? ZERO : value);

// Mirrors lib/lot-control.ts reversePurchaseLotBalance(), line by line, lot row by lot row.
const applySequential = (balances: Balances, items: PurchaseLotReversalItem[], lots: PurchaseItemLotRow[]) => {
  for (const item of items) {
    for (const lot of lots.filter((row) => row.purchaseItemId === item.id)) {
      const k = key(item.productId, lot.lotNo);
      const current = balances.get(k);
      if (current === undefined) continue; // updateMany matches no LotBalance row
      balances.set(k, clampZero(current.sub(lot.qty)));
    }
  }
};

// Mirrors the batched UPDATE ... FROM (VALUES ...) in reversePurchaseLotBalancesBatch().
const applyBatched = (balances: Balances, items: PurchaseLotReversalItem[], lots: PurchaseItemLotRow[]) => {
  for (const d of aggregatePurchaseLotDecrements(items, lots)) {
    const k = key(d.productId, d.lotNo);
    const current = balances.get(k);
    if (current === undefined) continue;
    balances.set(k, clampZero(current.sub(d.dec)));
  }
};

// Deterministic pseudo-random generator so the property test is reproducible.
const makeRandom = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

test("batched lot reversal equals per-line decrement-then-clamp (randomized)", () => {
  const random = makeRandom(20260923);
  const qty4 = (max: number) => new Prisma.Decimal(Math.round(random() * max * 10000) / 10000);

  for (let round = 0; round < 500; round += 1) {
    const products = ["p1", "p2", "p3"];
    const lotNos = ["L1", "L2", "L3"];
    const items: PurchaseLotReversalItem[] = Array.from({ length: 1 + Math.floor(random() * 6) }, (_, i) => ({
      id: `item-${i}`,
      productId: products[Math.floor(random() * products.length)],
    }));
    const lots: PurchaseItemLotRow[] = [];
    for (const item of items) {
      const count = Math.floor(random() * 4);
      for (let i = 0; i < count; i += 1) {
        lots.push({ purchaseItemId: item.id, lotNo: lotNos[Math.floor(random() * lotNos.length)], qty: qty4(50) });
      }
    }
    // A lot row that belongs to a line not being reversed must be ignored by both.
    lots.push({ purchaseItemId: "other-item", lotNo: "L1", qty: qty4(50) });

    const initial: Balances = new Map();
    for (const productId of products) {
      for (const lotNo of lotNos) {
        if (random() < 0.15) continue; // some (product, lot) pairs have no LotBalance row
        // Balances may already be low or even negative (legacy data).
        initial.set(key(productId, lotNo), new Prisma.Decimal(Math.round((random() * 120 - 10) * 10000) / 10000));
      }
    }

    const sequential = new Map(initial);
    const batched = new Map(initial);
    applySequential(sequential, items, lots);
    applyBatched(batched, items, lots);

    for (const [k, value] of sequential) {
      assert.equal(batched.get(k)?.toString(), value.toString(), `round ${round}, balance ${k}`);
    }
  }
});

test("aggregatePurchaseLotDecrements sums the same lot across lines of one product", () => {
  const decrements = aggregatePurchaseLotDecrements(
    [
      { id: "a", productId: "p1" },
      { id: "b", productId: "p1" },
      { id: "c", productId: "p2" },
    ],
    [
      { purchaseItemId: "a", lotNo: "L1", qty: new Prisma.Decimal("1.2500") },
      { purchaseItemId: "b", lotNo: "L1", qty: new Prisma.Decimal("2.0001") },
      { purchaseItemId: "c", lotNo: "L1", qty: new Prisma.Decimal("5") },
      { purchaseItemId: "zzz", lotNo: "L1", qty: new Prisma.Decimal("9") },
    ],
  );

  assert.deepEqual(
    decrements.map((d) => [d.productId, d.lotNo, d.dec.toString()]),
    [
      ["p1", "L1", "3.2501"],
      ["p2", "L1", "5"],
    ],
  );
});

test("reversePurchaseLotBalancesBatch runs one lookup and one UPDATE, or nothing without lots", async () => {
  const calls: string[] = [];
  const makeTx = (lots: PurchaseItemLotRow[]) =>
    ({
      purchaseItemLot: {
        findMany: async () => {
          calls.push("findMany");
          return lots;
        },
      },
      $executeRaw: async () => {
        calls.push("update");
        return 1;
      },
    }) as unknown as Parameters<typeof reversePurchaseLotBalancesBatch>[0];

  await reversePurchaseLotBalancesBatch(makeTx([]), []);
  assert.deepEqual(calls, [], "no purchase lines: no query");

  await reversePurchaseLotBalancesBatch(makeTx([]), [{ id: "a", productId: "p1" }]);
  assert.deepEqual(calls, ["findMany"], "lines without lots: lookup only");

  calls.length = 0;
  await reversePurchaseLotBalancesBatch(
    makeTx([
      { purchaseItemId: "a", lotNo: "L1", qty: new Prisma.Decimal(1) },
      { purchaseItemId: "b", lotNo: "L2", qty: new Prisma.Decimal(2) },
    ]),
    [
      { id: "a", productId: "p1" },
      { id: "b", productId: "p2" },
    ],
  );
  assert.deepEqual(calls, ["findMany", "update"], "many lines: one lookup + one UPDATE");
});
