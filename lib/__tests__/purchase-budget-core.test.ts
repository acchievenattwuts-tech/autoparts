import assert from "node:assert/strict";
import test from "node:test";

import {
  applyPurchaseBudgetChange,
  computePurchaseBudgetFigures,
  computePurchaseBudgetUsage,
  isCountedInPurchaseBudget,
  isPurchaseBudgetLevelWorse,
  parsePurchaseBudgetSettings,
  previewPurchaseBudget,
  PURCHASE_BUDGET_CAP_KEY,
  PURCHASE_BUDGET_DEFAULT_THRESHOLD_PCT,
  PURCHASE_BUDGET_STARTED_ON_KEY,
  PURCHASE_BUDGET_THRESHOLD_KEY,
  resolvePurchaseBudgetLevel,
} from "@/lib/purchase-budget-core";

const figures = (budget: number, purchases: number, salesCost = 0, otherEffect = 0, thresholdPct = 10) =>
  computePurchaseBudgetFigures(budget, thresholdPct, { purchases, salesCost, otherEffect });

test("remaining = budget − purchases + cost of goods sold ± other stock moves (counted from the start date)", () => {
  const result = figures(50_000, 30_000, 12_000, -500);
  assert.equal(result.remaining, 31_500);
  assert.equal(result.used, 18_500);
  assert.equal(result.level, "ok");
  assert.equal(result.remainingPct, 63);
});

test("stock already on hand does not use the budget; its sales still give budget back", () => {
  // Nothing bought since the start, old stock sold at a cost of 15,000.
  const result = figures(50_000, 0, 15_000);
  assert.equal(result.remaining, 65_000);
  assert.equal(result.used, -15_000);
  assert.equal(result.remainingPct, 130);
  assert.equal(result.level, "ok");
});

test("returns to suppliers and allowances give budget back, customer returns and debit notes use it", () => {
  assert.equal(figures(50_000, 10_000, 0, 2_500).remaining, 42_500);
  assert.equal(figures(50_000, 10_000, 0, -1_250.5).remaining, 38_749.5);
});

test("levels: below the warning line is low, below zero is over", () => {
  assert.equal(figures(50_000, 45_000.01).level, "low");
  assert.equal(figures(50_000, 45_000).level, "ok");
  assert.equal(figures(50_000, 50_000.01).level, "over");
  assert.equal(figures(50_000, 50_000.01).remaining, -0.01);
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

test("budget changes: top-up, cut (never below zero), new round", () => {
  assert.equal(applyPurchaseBudgetChange(50_000, "add", 10_000), 60_000);
  assert.equal(applyPurchaseBudgetChange(50_000, "subtract", 10_000.25), 39_999.75);
  assert.equal(applyPurchaseBudgetChange(1_000, "subtract", 5_000), 0);
  assert.equal(applyPurchaseBudgetChange(50_000, "restart", 80_000), 80_000);
  assert.equal(applyPurchaseBudgetChange(null, "restart", 50_000), 50_000);
});

test("settings: a budget needs both an amount and a start date; a bad warning line falls back", () => {
  assert.deepEqual(parsePurchaseBudgetSettings([]), {
    budget: null,
    thresholdPct: PURCHASE_BUDGET_DEFAULT_THRESHOLD_PCT,
    startedOn: null,
  });
  assert.deepEqual(
    parsePurchaseBudgetSettings([
      { key: PURCHASE_BUDGET_CAP_KEY, value: "50000.00" },
      { key: PURCHASE_BUDGET_THRESHOLD_KEY, value: "15" },
      { key: PURCHASE_BUDGET_STARTED_ON_KEY, value: "2026-10-04" },
    ]),
    { budget: 50_000, thresholdPct: 15, startedOn: "2026-10-04" },
  );
  assert.deepEqual(
    parsePurchaseBudgetSettings([{ key: PURCHASE_BUDGET_CAP_KEY, value: "50000.00" }]),
    { budget: null, thresholdPct: PURCHASE_BUDGET_DEFAULT_THRESHOLD_PCT, startedOn: null },
  );
  const broken = parsePurchaseBudgetSettings([
    { key: PURCHASE_BUDGET_CAP_KEY, value: "abc" },
    { key: PURCHASE_BUDGET_THRESHOLD_KEY, value: "75" },
    { key: PURCHASE_BUDGET_STARTED_ON_KEY, value: "04/10/2026" },
  ]);
  assert.deepEqual(broken, { budget: null, thresholdPct: PURCHASE_BUDGET_DEFAULT_THRESHOLD_PCT, startedOn: null });
});

test("documents count from the start date inclusive", () => {
  assert.equal(isCountedInPurchaseBudget("2026-10-04", "2026-10-04"), true);
  assert.equal(isCountedInPurchaseBudget("2026-10-05", "2026-10-04"), true);
  assert.equal(isCountedInPurchaseBudget("2026-10-03", "2026-10-04"), false);
  assert.equal(isCountedInPurchaseBudget("", "2026-10-04"), false);
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
  const view = { budget: 50_000, remaining: 31_500, thresholdPct: 10, startedOn: "2026-10-04" };
  assert.deepEqual(previewPurchaseBudget(view, 31_500, 6_500), {
    remainingBefore: 31_500,
    usage: 6_500,
    remainingAfter: 25_000,
    remainingAfterPct: 50,
    levelAfter: "ok",
  });
  assert.equal(previewPurchaseBudget(view, 31_500, 27_000).levelAfter, "low");
  const over = previewPurchaseBudget(view, 31_500, 32_000);
  assert.equal(over.remainingAfter, -500);
  assert.equal(over.levelAfter, "over");
  // Editing a saved bill down gives budget back.
  assert.equal(previewPurchaseBudget(view, 10_000, -5_000).remainingAfter, 15_000);
});
