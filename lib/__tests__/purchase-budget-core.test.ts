import assert from "node:assert/strict";
import test from "node:test";

import {
  applyPurchaseBudgetCapChange,
  computePurchaseBudgetFigures,
  computePurchaseBudgetUsage,
  isPurchaseBudgetLevelWorse,
  parsePurchaseBudgetSettings,
  previewPurchaseBudget,
  PURCHASE_BUDGET_CAP_KEY,
  PURCHASE_BUDGET_DEFAULT_THRESHOLD_PCT,
  PURCHASE_BUDGET_STARTED_ON_KEY,
  PURCHASE_BUDGET_THRESHOLD_KEY,
  resolvePurchaseBudgetLevel,
} from "@/lib/purchase-budget-core";

const figures = (cap: number, stockValue: number, depositOutstanding = 0, nonTrackedNet = 0, thresholdPct = 10) =>
  computePurchaseBudgetFigures({ cap, thresholdPct, stockValue, depositOutstanding, nonTrackedNet });

test("remaining = cap − stock value at cost − open deposits − non-tracked net", () => {
  const result = figures(1_400_000, 1_185_320, 18_500, 0);
  assert.equal(result.used, 1_203_820);
  assert.equal(result.remaining, 196_180);
  assert.equal(result.level, "ok");
  assert.equal(Math.round(result.usedPct * 10) / 10, 86);
});

test("non-tracked purchases use the budget, their cost of sales gives it back", () => {
  assert.equal(figures(100_000, 50_000, 0, 2_500).remaining, 47_500);
  assert.equal(figures(100_000, 50_000, 0, -1_000).remaining, 51_000);
});

test("levels: below the warning line is low, below zero is over", () => {
  assert.equal(figures(1_400_000, 1_289_100, 18_500).level, "low");
  assert.equal(figures(1_400_000, 1_417_250, 18_500).level, "over");
  assert.equal(figures(1_400_000, 1_417_250, 18_500).remaining, -35_750);
  // Exactly on the line is still ok; the line itself is configurable.
  assert.equal(resolvePurchaseBudgetLevel(10, 100, 10), "ok");
  assert.equal(resolvePurchaseBudgetLevel(9.99, 100, 10), "low");
  assert.equal(resolvePurchaseBudgetLevel(0, 100, 0), "ok");
  assert.equal(resolvePurchaseBudgetLevel(-0.01, 100, 0), "over");
});

test("only a worse level alerts", () => {
  assert.equal(isPurchaseBudgetLevelWorse("ok", "low"), true);
  assert.equal(isPurchaseBudgetLevelWorse("ok", "over"), true);
  assert.equal(isPurchaseBudgetLevelWorse("low", "over"), true);
  assert.equal(isPurchaseBudgetLevelWorse("low", "low"), false);
  assert.equal(isPurchaseBudgetLevelWorse("over", "low"), false);
  assert.equal(isPurchaseBudgetLevelWorse("over", "ok"), false);
});

test("cap changes: add, subtract (never below zero), set", () => {
  assert.equal(applyPurchaseBudgetCapChange(1_400_000, "add", 50_000), 1_450_000);
  assert.equal(applyPurchaseBudgetCapChange(1_400_000, "subtract", 100_000.25), 1_299_999.75);
  assert.equal(applyPurchaseBudgetCapChange(1_000, "subtract", 5_000), 0);
  assert.equal(applyPurchaseBudgetCapChange(1_400_000, "set", 1_250_000), 1_250_000);
  assert.equal(applyPurchaseBudgetCapChange(null, "set", 900_000), 900_000);
  assert.equal(applyPurchaseBudgetCapChange(null, "add", 900_000), 900_000);
});

test("settings: a missing or malformed cap means not set up; a bad warning line falls back", () => {
  assert.deepEqual(parsePurchaseBudgetSettings([]), {
    cap: null,
    thresholdPct: PURCHASE_BUDGET_DEFAULT_THRESHOLD_PCT,
    startedOn: null,
  });
  assert.deepEqual(
    parsePurchaseBudgetSettings([
      { key: PURCHASE_BUDGET_CAP_KEY, value: "1400000.00" },
      { key: PURCHASE_BUDGET_THRESHOLD_KEY, value: "15" },
      { key: PURCHASE_BUDGET_STARTED_ON_KEY, value: "2026-10-03" },
    ]),
    { cap: 1_400_000, thresholdPct: 15, startedOn: "2026-10-03" },
  );
  const broken = parsePurchaseBudgetSettings([
    { key: PURCHASE_BUDGET_CAP_KEY, value: "abc" },
    { key: PURCHASE_BUDGET_THRESHOLD_KEY, value: "75" },
    { key: PURCHASE_BUDGET_STARTED_ON_KEY, value: "03/10/2026" },
  ]);
  assert.deepEqual(broken, { cap: null, thresholdPct: PURCHASE_BUDGET_DEFAULT_THRESHOLD_PCT, startedOn: null });
});

test("a purchase uses the value it puts into stock (lib/purchase-inventory-cost.ts examples)", () => {
  const lines = [{ qty: 10, costPrice: 107 }];
  // NO_VAT: lines + shipping − header discount.
  assert.equal(computePurchaseBudgetUsage({ lines: [{ qty: 4, costPrice: 250 }], shippingFee: 120, discount: 20, vatType: "NO_VAT", vatRate: 0, inputVatRecoverable: false }), 1_100);
  // Recoverable INCLUDING_VAT: the pre-VAT amount; not recoverable: everything paid.
  assert.equal(computePurchaseBudgetUsage({ lines, shippingFee: 10.7, discount: 0, vatType: "INCLUDING_VAT", vatRate: 7, inputVatRecoverable: true }), 1_010);
  assert.equal(computePurchaseBudgetUsage({ lines, shippingFee: 10.7, discount: 0, vatType: "INCLUDING_VAT", vatRate: 7, inputVatRecoverable: false }), 1_080.7);
  const excluding = [{ qty: 10, costPrice: 100 }];
  assert.equal(computePurchaseBudgetUsage({ lines: excluding, shippingFee: 10, discount: 0, vatType: "EXCLUDING_VAT", vatRate: 7, inputVatRecoverable: false }), 1_080.7);
  assert.equal(computePurchaseBudgetUsage({ lines: excluding, shippingFee: 10, discount: 0, vatType: "EXCLUDING_VAT", vatRate: 7, inputVatRecoverable: true }), 1_010);
});

test("purchase form preview: before, this bill, after", () => {
  const view = { cap: 1_400_000, remaining: 196_180, thresholdPct: 10 };
  assert.deepEqual(previewPurchaseBudget(view, 196_180, 38_420), {
    remainingBefore: 196_180,
    usage: 38_420,
    remainingAfter: 157_760,
    remainingAfterPct: (157_760 / 1_400_000) * 100,
    levelAfter: "ok",
  });
  assert.equal(previewPurchaseBudget(view, 196_180, 78_420).levelAfter, "low");
  const over = previewPurchaseBudget(view, 92_400, 128_150);
  assert.equal(over.remainingAfter, -35_750);
  assert.equal(over.levelAfter, "over");
  // Editing a saved bill down gives budget back.
  assert.equal(previewPurchaseBudget(view, 100_000, -5_000).remainingAfter, 105_000);
});
