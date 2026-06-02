import test from "node:test";
import assert from "node:assert/strict";

import { ShopeeSyncMode } from "@/lib/generated/prisma";

import { calculateShopeeTargetStock, resolveShopeeStockStatus } from "../stock-utils";

test("calculateShopeeTargetStock applies a non-negative stock buffer", () => {
  assert.equal(calculateShopeeTargetStock(5, 1), 4);
  assert.equal(calculateShopeeTargetStock(5, 10), 0);
  assert.equal(calculateShopeeTargetStock(-3, 1), 0);
  assert.equal(calculateShopeeTargetStock(4.8, 1.2), 3);
});

test("resolveShopeeStockStatus keeps disabled and monitor mappings passive", () => {
  assert.equal(
    resolveShopeeStockStatus({
      syncMode: ShopeeSyncMode.DISABLED,
      targetStock: 4,
      lastPushedStock: null,
      lastError: null,
    }),
    "DISABLED",
  );
  assert.equal(
    resolveShopeeStockStatus({
      syncMode: ShopeeSyncMode.MONITOR_ONLY,
      targetStock: 4,
      lastPushedStock: null,
      lastError: null,
    }),
    "MONITOR_ONLY",
  );
});

test("resolveShopeeStockStatus flags push mappings by last push state", () => {
  assert.equal(
    resolveShopeeStockStatus({
      syncMode: ShopeeSyncMode.PUSH_INTERNAL_TO_SHOPEE,
      targetStock: 4,
      lastPushedStock: null,
      lastError: null,
    }),
    "NOT_PUSHED",
  );
  assert.equal(
    resolveShopeeStockStatus({
      syncMode: ShopeeSyncMode.PUSH_INTERNAL_TO_SHOPEE,
      targetStock: 4,
      lastPushedStock: 4,
      lastError: null,
    }),
    "IN_SYNC",
  );
  assert.equal(
    resolveShopeeStockStatus({
      syncMode: ShopeeSyncMode.PUSH_INTERNAL_TO_SHOPEE,
      targetStock: 4,
      lastPushedStock: 2,
      lastError: null,
    }),
    "NEEDS_PUSH",
  );
  assert.equal(
    resolveShopeeStockStatus({
      syncMode: ShopeeSyncMode.PUSH_INTERNAL_TO_SHOPEE,
      targetStock: 4,
      lastPushedStock: 2,
      lastError: "rate limit",
    }),
    "PUSH_FAILED",
  );
});
