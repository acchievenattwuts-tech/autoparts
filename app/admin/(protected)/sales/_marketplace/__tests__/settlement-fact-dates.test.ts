import assert from "node:assert/strict";
import test from "node:test";

import { parseDateOnlyToDate } from "@/lib/th-date";
import { loadSettlementFactDates } from "../settlement-fact-dates";

// Owner decision S2: the cancel's month lock (and the history page's preview of it) reads where a
// settlement's fee facts (EXPENSE of its fee Expense) and income facts (OTHER_INCOME of the
// settlement) are dated now, in one query, and maps them back to the settlement.

type FactRow = { sourceType: string; sourceId: string; businessDate: Date };

const makeClient = (rows: FactRow[]) => {
  const calls: unknown[] = [];
  const client = {
    factProfit: {
      findMany: async (args: unknown) => {
        calls.push(args);
        return rows;
      },
    },
  };
  return { client: client as unknown as Parameters<typeof loadSettlementFactDates>[0], calls };
};

const SEPTEMBER = parseDateOnlyToDate("2026-09-05");
const AUGUST = parseDateOnlyToDate("2026-08-20");

test("fee and income fact dates are mapped back to their settlement in one query", async () => {
  const { client, calls } = makeClient([
    { sourceType: "EXPENSE", sourceId: "exp-1", businessDate: AUGUST },
    { sourceType: "EXPENSE", sourceId: "exp-1", businessDate: SEPTEMBER },
    { sourceType: "OTHER_INCOME", sourceId: "set-2", businessDate: AUGUST },
    { sourceType: "EXPENSE", sourceId: "exp-unknown", businessDate: AUGUST },
  ]);
  const dates = await loadSettlementFactDates(client, [
    { id: "set-1", expenseId: "exp-1" },
    { id: "set-2", expenseId: null },
  ]);
  assert.deepEqual(Object.fromEntries(dates), { "set-1": [AUGUST, SEPTEMBER], "set-2": [AUGUST] });
  assert.deepEqual(calls, [{
    where: {
      isActive: true,
      OR: [
        { sourceType: "OTHER_INCOME", sourceId: { in: ["set-1", "set-2"] } },
        { sourceType: "EXPENSE", sourceId: { in: ["exp-1"] } },
      ],
    },
    select: { sourceType: true, sourceId: true, businessDate: true },
    distinct: ["sourceType", "sourceId", "businessDate"],
  }]);
});

test("no settlements → no query; no fee Expense → only the income facts are read", async () => {
  const empty = makeClient([]);
  assert.equal((await loadSettlementFactDates(empty.client, [])).size, 0);
  assert.equal(empty.calls.length, 0);

  const incomeOnly = makeClient([]);
  await loadSettlementFactDates(incomeOnly.client, [{ id: "set-1", expenseId: null }]);
  assert.deepEqual((incomeOnly.calls[0] as { where: { OR: unknown[] } }).where.OR, [
    { sourceType: "OTHER_INCOME", sourceId: { in: ["set-1"] } },
  ]);
});

test("a failed read is rethrown with context, never swallowed", async () => {
  const client = {
    factProfit: {
      findMany: async () => {
        throw new Error("connection reset");
      },
    },
  } as unknown as Parameters<typeof loadSettlementFactDates>[0];
  await assert.rejects(loadSettlementFactDates(client, [{ id: "set-1", expenseId: null }]), /Failed to load marketplace settlement profit fact dates/);
});
