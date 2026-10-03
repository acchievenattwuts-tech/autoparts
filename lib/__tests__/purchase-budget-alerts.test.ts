import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

import type { PurchaseBudgetLevel } from "@/lib/purchase-budget-core";

type FakeTx = {
  $executeRaw: () => Promise<number>;
  siteContent: {
    findUnique: () => Promise<{ value: string } | null>;
    upsert: (args: { update: { value: string } }) => Promise<void>;
  };
};

let storedLevel: string | null = null;
let currentLevel: PurchaseBudgetLevel | null = "ok";
let alerts: Array<{ level: string; remaining: number }> = [];
let checkPurchaseBudgetAlert: typeof import("@/lib/purchase-budget-alerts").checkPurchaseBudgetAlert;

const fakeTx: FakeTx = {
  $executeRaw: async () => 0,
  siteContent: {
    findUnique: async () => (storedLevel === null ? null : { value: storedLevel }),
    upsert: async ({ update }) => { storedLevel = update.value; },
  },
};

const remainingFor = (level: PurchaseBudgetLevel): number => (level === "over" ? -35_750 : level === "low" ? 92_400 : 196_180);

before(async () => {
  mock.module("@/lib/db", {
    namedExports: { dbTx: async <T>(fn: (tx: FakeTx) => Promise<T>): Promise<T> => fn(fakeTx) },
  });
  mock.module("@/lib/purchase-budget", {
    namedExports: {
      getPurchaseBudgetSnapshot: async () =>
        currentLevel === null
          ? null
          : {
              figures: {
                level: currentLevel,
                cap: 1_400_000,
                remaining: remainingFor(currentLevel),
                remainingPct: (remainingFor(currentLevel) / 1_400_000) * 100,
                thresholdPct: 10,
              },
            },
    },
  });
  mock.module("@/lib/notifications", {
    namedExports: {
      notifyPurchaseBudgetAlert: async (figures: { level: string; remaining: number }) => {
        alerts.push({ level: figures.level, remaining: figures.remaining });
        return 1;
      },
    },
  });
  ({ checkPurchaseBudgetAlert } = await import("@/lib/purchase-budget-alerts"));
});

beforeEach(() => {
  storedLevel = null;
  currentLevel = "ok";
  alerts = [];
});

test("no cap yet: nothing is checked, stored or sent", async () => {
  currentLevel = null;
  assert.deepEqual(await checkPurchaseBudgetAlert(), { checked: false, previous: null, current: null, notified: false });
  assert.equal(storedLevel, null);
  assert.equal(alerts.length, 0);
});

test("ok → low alerts once; staying low stays quiet", async () => {
  currentLevel = "low";
  const first = await checkPurchaseBudgetAlert();
  assert.equal(first.notified, true);
  assert.deepEqual(alerts, [{ level: "low", remaining: 92_400 }]);
  assert.equal(storedLevel, "low");

  const second = await checkPurchaseBudgetAlert();
  assert.equal(second.notified, false);
  assert.equal(alerts.length, 1);
});

test("low → over alerts again", async () => {
  storedLevel = "low";
  currentLevel = "over";
  const result = await checkPurchaseBudgetAlert();
  assert.equal(result.notified, true);
  assert.deepEqual(alerts, [{ level: "over", remaining: -35_750 }]);
  assert.equal(storedLevel, "over");
});

test("an improvement re-arms silently, so the next drop alerts", async () => {
  storedLevel = "over";
  currentLevel = "ok";
  const recovered = await checkPurchaseBudgetAlert();
  assert.equal(recovered.notified, false);
  assert.equal(storedLevel, "ok");

  currentLevel = "low";
  const dropped = await checkPurchaseBudgetAlert();
  assert.equal(dropped.notified, true);
  assert.deepEqual(alerts, [{ level: "low", remaining: 92_400 }]);
});

test("over → low (an improvement) never alerts", async () => {
  storedLevel = "over";
  currentLevel = "low";
  const result = await checkPurchaseBudgetAlert();
  assert.equal(result.notified, false);
  assert.equal(storedLevel, "low");
  assert.equal(alerts.length, 0);
});
