import assert from "node:assert/strict";
import test from "node:test";

import { Prisma } from "@/lib/generated/prisma";
import {
  INVENTORY_TRACKING_NON_TRACKED,
  INVENTORY_TRACKING_TRACKED,
  isInventoryTracked,
  resolveSaleUnitCost,
} from "@/lib/inventory-tracking";

// Characterisation tests: they pin what lib/inventory-tracking.ts does today
// (2026-11-12). resolveSaleUnitCost feeds the cost snapshot of sales, Shopee sales
// and promotion margins, so any change here changes reported profit.
// The case marked "CURRENT BEHAVIOUR — question" waits for an owner decision.

test("constants match the InventoryTracking enum values", () => {
  assert.equal(INVENTORY_TRACKING_TRACKED, "TRACKED");
  assert.equal(INVENTORY_TRACKING_NON_TRACKED, "NON_TRACKED");
});

test("isInventoryTracked: only the exact NON_TRACKED value is untracked", () => {
  assert.equal(isInventoryTracked("TRACKED"), true);
  assert.equal(isInventoryTracked("NON_TRACKED"), false);
  // Missing or unknown values default to tracked (the schema default is TRACKED).
  assert.equal(isInventoryTracked(null), true);
  assert.equal(isInventoryTracked(undefined), true);
  assert.equal(isInventoryTracked(""), true);
  // Case- and whitespace-sensitive; the DB enum only ever yields the exact value.
  assert.equal(isInventoryTracked("non_tracked"), true);
  assert.equal(isInventoryTracked(" NON_TRACKED"), true);
});

test("resolveSaleUnitCost: tracked products use avgCost, untracked use costPrice", () => {
  const avgCost = new Prisma.Decimal("123.4567");
  const costPrice = new Prisma.Decimal("100.00");

  assert.equal(resolveSaleUnitCost({ inventoryTracking: "TRACKED", avgCost, costPrice }), 123.4567);
  assert.equal(resolveSaleUnitCost({ inventoryTracking: null, avgCost, costPrice }), 123.4567);
  assert.equal(resolveSaleUnitCost({ inventoryTracking: undefined, avgCost, costPrice }), 123.4567);
  assert.equal(resolveSaleUnitCost({ inventoryTracking: "NON_TRACKED", avgCost, costPrice }), 100);
});

test("resolveSaleUnitCost returns Number(value) with no rounding and no fallback", () => {
  // Full precision is kept (no rounding to 2 decimals).
  assert.equal(
    resolveSaleUnitCost({ inventoryTracking: "TRACKED", avgCost: new Prisma.Decimal("0.3333"), costPrice: 1 }),
    0.3333,
  );
  // Strings and plain numbers are accepted.
  assert.equal(resolveSaleUnitCost({ inventoryTracking: "TRACKED", avgCost: "12.50", costPrice: 0 }), 12.5);
  assert.equal(resolveSaleUnitCost({ inventoryTracking: "NON_TRACKED", avgCost: 0, costPrice: 80 }), 80);
  // A tracked product with avgCost 0 costs 0; costPrice is never used as a fallback.
  assert.equal(resolveSaleUnitCost({ inventoryTracking: "TRACKED", avgCost: 0, costPrice: 80 }), 0);
  assert.equal(
    resolveSaleUnitCost({ inventoryTracking: "TRACKED", avgCost: new Prisma.Decimal(0), costPrice: 80 }),
    0,
  );
  // null becomes 0.
  assert.equal(resolveSaleUnitCost({ inventoryTracking: "TRACKED", avgCost: null, costPrice: 80 }), 0);
  assert.equal(resolveSaleUnitCost({ inventoryTracking: "NON_TRACKED", avgCost: 5, costPrice: null }), 0);
});

test("CURRENT BEHAVIOUR — question: a missing (undefined) cost field yields NaN, not 0 or an error", () => {
  // Only reachable if a caller forgets to select the field; `avgCost: unknown` lets it compile.
  assert.ok(
    Number.isNaN(resolveSaleUnitCost({ inventoryTracking: "TRACKED", avgCost: undefined, costPrice: 80 })),
  );
  assert.ok(
    Number.isNaN(resolveSaleUnitCost({ inventoryTracking: "NON_TRACKED", avgCost: 5, costPrice: undefined })),
  );
});
