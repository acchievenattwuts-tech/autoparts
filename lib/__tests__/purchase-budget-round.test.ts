import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPurchaseBudgetLedgerDays,
  reconcilePurchaseBudgetEvents,
  resolvePurchaseBudgetRound,
  type PurchaseBudgetAuditEntry,
} from "@/lib/purchase-budget-round";

const entry = (id: string, createdAt: string, before: unknown, after: unknown, meta: unknown): PurchaseBudgetAuditEntry => ({
  id,
  createdAt: new Date(createdAt),
  userName: "เจ้าของร้าน",
  before,
  after,
  meta,
});

// The entry production holds since 2026-10-04 (written by the first version of the cap action).
const firstSetup = entry(
  "a1",
  "2026-10-04T02:00:00.000Z",
  { cap: null, thresholdPct: null },
  { cap: 50_000, thresholdPct: 10 },
  { mode: "set", amount: 50_000, reason: "กันงบ", startedOn: "2026-10-04" },
);

test("the first setup starts the round on its start date", () => {
  assert.deepEqual(resolvePurchaseBudgetRound([firstSetup]), [
    { id: "a1", dateKey: "2026-10-04", kind: "start", amount: 50_000, who: "เจ้าของร้าน", reason: "กันงบ" },
  ]);
});

test("top-ups and cuts follow the start, dated on the Thailand day they were saved", () => {
  const events = resolvePurchaseBudgetRound([
    entry("a3", "2026-10-07T04:00:00.000Z", { cap: 60_000 }, { cap: 55_000 }, { mode: "subtract", amount: 5_000, reason: "ลดงบ" }),
    firstSetup,
    // 18:30 UTC on the 5th is 01:30 on the 6th in Thailand.
    entry("a2", "2026-10-05T18:30:00.000Z", { cap: 50_000 }, { cap: 60_000 }, { mode: "add", amount: 10_000, reason: "ของเข้าเยอะ" }),
  ]);
  assert.deepEqual(
    events.map((event) => [event.id, event.dateKey, event.kind, event.amount]),
    [
      ["a1", "2026-10-04", "start", 50_000],
      ["a2", "2026-10-06", "add", 10_000],
      ["a3", "2026-10-07", "subtract", -5_000],
    ],
  );
});

test("a new round drops everything before it and starts on the chosen date", () => {
  const events = resolvePurchaseBudgetRound([
    firstSetup,
    entry("a2", "2026-10-06T03:00:00.000Z", { cap: 50_000 }, { cap: 60_000 }, { mode: "add", amount: 10_000, reason: "-" }),
    entry("a3", "2026-11-02T03:00:00.000Z", { cap: 60_000 }, { cap: 80_000 }, { mode: "restart", amount: 80_000, reason: "รอบใหม่", startedOn: "2026-11-01" }),
    entry("a4", "2026-11-03T03:00:00.000Z", { cap: 80_000 }, { cap: 85_000 }, { mode: "add", amount: 5_000, reason: "-" }),
  ]);
  assert.deepEqual(
    events.map((event) => [event.id, event.dateKey, event.kind, event.amount]),
    [
      ["a3", "2026-11-01", "restart", 80_000],
      ["a4", "2026-11-03", "add", 5_000],
    ],
  );
});

test("no setup entry: no events", () => {
  assert.deepEqual(resolvePurchaseBudgetRound([]), []);
});

test("the events always add up to the stored budget and start on the stored start date", () => {
  assert.deepEqual(reconcilePurchaseBudgetEvents([], 50_000, "2026-10-04"), [
    { id: "start", dateKey: "2026-10-04", kind: "start", amount: 50_000, who: "-", reason: "-" },
  ]);
  const events = resolvePurchaseBudgetRound([firstSetup]);
  assert.deepEqual(reconcilePurchaseBudgetEvents(events, 50_000, "2026-10-04"), events);
  assert.equal(reconcilePurchaseBudgetEvents(events, 55_000, "2026-10-04")[0].amount, 55_000);
  // The stored start date wins over the audit trail.
  assert.equal(reconcilePurchaseBudgetEvents(events, 50_000, "2026-10-02")[0].dateKey, "2026-10-02");
  // A top-up without its round start: a synthetic start carries the rest of the amount.
  const topUpOnly = [{ id: "a2", dateKey: "2026-10-06", kind: "add" as const, amount: 10_000, who: "-", reason: "-" }];
  assert.deepEqual(
    reconcilePurchaseBudgetEvents(topUpOnly, 60_000, "2026-10-04").map((event) => [event.id, event.dateKey, event.kind, event.amount]),
    [
      ["start", "2026-10-04", "start", 50_000],
      ["a2", "2026-10-06", "add", 10_000],
    ],
  );
});

test("ledger days: budget entries and document effects per day, with the balance at each day's end", () => {
  const days = buildPurchaseBudgetLedgerDays(
    [
      { dateKey: "2026-10-05", plus: 500, minus: 0, docCount: 1 },
      { dateKey: "2026-10-04", plus: 1_200, minus: -3_000.5, docCount: 3 },
    ],
    [
      { id: "a1", dateKey: "2026-10-04", kind: "start", amount: 50_000, who: "-", reason: "-" },
      { id: "a2", dateKey: "2026-10-06", kind: "add", amount: 10_000, who: "-", reason: "-" },
    ],
  );
  assert.deepEqual(days, [
    { dateKey: "2026-10-04", budgetChange: 50_000, plus: 1_200, minus: -3_000.5, net: 48_199.5, entryCount: 4, endBalance: 48_199.5 },
    { dateKey: "2026-10-05", budgetChange: 0, plus: 500, minus: 0, net: 500, entryCount: 1, endBalance: 48_699.5 },
    { dateKey: "2026-10-06", budgetChange: 10_000, plus: 0, minus: 0, net: 10_000, entryCount: 1, endBalance: 58_699.5 },
  ]);
});
