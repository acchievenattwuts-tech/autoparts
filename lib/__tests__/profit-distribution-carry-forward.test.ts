import assert from "node:assert/strict";
import test, { before, mock } from "node:test";

// The import graph reaches lib/db.ts, which throws without a connection string.
process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";

// `mock.module` only exists when node runs with --experimental-test-module-mocks
// (use `npm run test:profit-distribution`). Skip instead of crashing when a plain
// `npx tsx --test` sweep picks this file up without the flag.
const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks — run via `npm run test:profit-distribution`";

/**
 * Regression coverage for `computeCarryForward()` — the rule that decides how
 * much of an earlier month rolls into the month being declared.
 *
 * The rule is cumulative: each earlier month contributes what it EARNED (read
 * live, so restatements are picked up on their own) minus what it SETTLED —
 * paid out, plus anything kept in the shop for good. The balance left over is
 * what rolls on, and the month that absorbs it reports it as settled, so it can
 * never be charged twice. The rows are labelled by cause: UNDECLARED (no
 * document), RESTATED (FactProfit rebuilt after the fact) and RETAINED (part of
 * the base deliberately kept back to roll forward).
 *
 * `listUndeclaredPriorPeriods()` backs the rule that a month may only be
 * declared once every earlier closed month already carries a document.
 *
 * Two hard floors apply: nothing rolls forward from before the very first
 * distribution (the shop starts with no opening balances), and nothing ever
 * rolls forward from before PROFIT_DISTRIBUTION_START_PERIOD (July 2026) —
 * the losses booked before the partners started sharing profit are written off.
 *
 * The mocks are registered ONCE (mock.module cannot re-mock a module within a
 * run) and read from mutable state so each test can vary the fixtures.
 */

type RetainedMode = "KEEP_IN_SHOP" | "CARRY_FORWARD";

type ActiveDistributionRow = {
  periodYear: number;
  periodMonth: number;
  snapshotNetProfit: number;
  /** Defaults to the whole snapshot — a month that shared out everything it earned. */
  distributedAmount?: number;
  /** Defaults to 0 / KEEP_IN_SHOP — i.e. a month that rolls nothing forward. */
  retainedAmount?: number;
  retainedMode?: RetainedMode;
};

type PeriodRef = { periodYear: number; periodMonth: number };

type FindManyArgs = { where?: { OR?: PeriodRef[] } };

function toActiveRow(row: ActiveDistributionRow) {
  return {
    periodYear: row.periodYear,
    periodMonth: row.periodMonth,
    activePeriodKey: periodKeyOf(row.periodYear, row.periodMonth),
    snapshotNetProfit: row.snapshotNetProfit,
    distributedAmount: row.distributedAmount ?? row.snapshotNetProfit,
    retainedAmount: row.retainedAmount ?? 0,
    retainedMode: row.retainedMode ?? "KEEP_IN_SHOP",
  };
}

let earliestActive: PeriodRef | null = null;
let activeRows: ActiveDistributionRow[] = [];
/** Net profit per "YYYY-MM" as FactProfit would report it *today*. */
let netProfitByMonth: Record<string, number> = {};
let aggregateCalls: string[] = [];

function roundTo2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function periodKeyOf(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

type ProfitDistributionModule = typeof import("@/lib/profit-distribution");

let computeCarryForward: ProfitDistributionModule["computeCarryForward"];
let getPeriodBounds: ProfitDistributionModule["getPeriodBounds"];
let isBeforeStartPeriod: ProfitDistributionModule["isBeforeStartPeriod"];
let isClosedPeriod: ProfitDistributionModule["isClosedPeriod"];
let getCurrentPeriod: ProfitDistributionModule["getCurrentPeriod"];
let listUndeclaredPriorPeriods: ProfitDistributionModule["listUndeclaredPriorPeriods"];
let startPeriod: ProfitDistributionModule["PROFIT_DISTRIBUTION_START_PERIOD"];

before(async () => {
  if (moduleMocksUnavailable) return;

  const { getThailandMonthKey } = await import("@/lib/th-date");

  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        profitDistribution: {
          findFirst: async () => earliestActive,
          // Faithful to the real queries: `computeCarryForward()` narrows by
          // `where.OR`, while `listActivePeriodKeys()` asks for every ACTIVE row.
          findMany: async (args: FindManyArgs) => {
            const rows = activeRows.map(toActiveRow);
            const periodFilter = args.where?.OR;
            if (!periodFilter) return rows;
            const wanted = new Set(
              periodFilter.map((item) => periodKeyOf(item.periodYear, item.periodMonth)),
            );
            return rows.filter((row) => wanted.has(row.activePeriodKey));
          },
        },
      },
    },
  });

  await mock.module("@/lib/profit-dashboard", {
    namedExports: {
      aggregateProfitSummary: async (start: Date) => {
        const monthKey = getThailandMonthKey(start);
        aggregateCalls.push(monthKey);
        const netProfitAmount = netProfitByMonth[monthKey] ?? 0;
        return {
          salesAmountExVat: 0,
          salesAmountIncVat: 0,
          costAmount: 0,
          expenseAmount: 0,
          grossProfit: netProfitAmount,
          netProfitAmount,
          marginPct: 0,
        };
      },
    },
  });

  const profitDistribution = await import("@/lib/profit-distribution");
  computeCarryForward = profitDistribution.computeCarryForward;
  getPeriodBounds = profitDistribution.getPeriodBounds;
  isBeforeStartPeriod = profitDistribution.isBeforeStartPeriod;
  isClosedPeriod = profitDistribution.isClosedPeriod;
  getCurrentPeriod = profitDistribution.getCurrentPeriod;
  listUndeclaredPriorPeriods = profitDistribution.listUndeclaredPriorPeriods;
  startPeriod = profitDistribution.PROFIT_DISTRIBUTION_START_PERIOD;
});

function resetFixtures(): void {
  earliestActive = null;
  activeRows = [];
  netProfitByMonth = {};
  aggregateCalls = [];
}

test(
  "the start period is July 2026 and earlier months are out of scope",
  { skip: moduleMocksUnavailable },
  async () => {
    assert.deepEqual({ year: startPeriod.year, month: startPeriod.month }, { year: 2026, month: 7 });
    assert.equal(isBeforeStartPeriod(2026, 6), true);
    assert.equal(isBeforeStartPeriod(2025, 12), true);
    assert.equal(isBeforeStartPeriod(2026, 7), false);
    assert.equal(isBeforeStartPeriod(2026, 8), false);
  },
);

test(
  "carries nothing forward until the first distribution exists",
  { skip: moduleMocksUnavailable },
  async () => {
    resetFixtures();
    // Profit sits in FactProfit, but none of it was ever declared.
    netProfitByMonth = { "2026-07": 120_000, "2026-08": 90_000, "2026-09": 80_000 };

    const result = await computeCarryForward(2026, 10);

    assert.equal(result.amount, 0, "no opening balances means history is ignored");
    assert.deepEqual(result.rows, []);
    assert.deepEqual(aggregateCalls, [], "must not scan FactProfit before the first document");
  },
);

test(
  "carries nothing for a period that predates the start month",
  { skip: moduleMocksUnavailable },
  async () => {
    resetFixtures();
    earliestActive = { periodYear: 2026, periodMonth: 7 };
    netProfitByMonth = { "2026-05": -110_383.1, "2026-06": -21_445.25 };

    const result = await computeCarryForward(2026, 6);

    assert.equal(result.amount, 0);
    assert.deepEqual(result.rows, []);
    assert.deepEqual(aggregateCalls, [], "an out-of-scope period must not even be computed");
  },
);

test(
  "never looks back past the start month, even if an older document exists",
  { skip: moduleMocksUnavailable },
  async () => {
    resetFixtures();
    // Defensive: a document dated before the arrangement must not widen the window.
    earliestActive = { periodYear: 2026, periodMonth: 3 };
    activeRows = [];
    netProfitByMonth = {
      "2026-04": -50_000, // out of scope — must never be scanned
      "2026-05": -110_383.1, // out of scope
      "2026-06": -21_445.25, // out of scope
      "2026-07": 10_000,
      "2026-08": 0,
    };

    const result = await computeCarryForward(2026, 9);

    assert.deepEqual(
      aggregateCalls,
      ["2026-07", "2026-08"],
      "the pre-arrangement losses are written off and never read",
    );
    assert.equal(result.amount, 10_000);
    assert.deepEqual(
      result.rows.map((row) => [row.month, row.kind, row.amount]),
      [[7, "UNDECLARED", 10_000]],
    );
  },
);

test(
  "rolls a loss month forward so the next month may distribute less",
  { skip: moduleMocksUnavailable },
  async () => {
    resetFixtures();
    earliestActive = { periodYear: 2026, periodMonth: 8 };
    // August was declared and its snapshot still matches — it contributes nothing.
    activeRows = [{ periodYear: 2026, periodMonth: 8, snapshotNetProfit: 120_000 }];
    netProfitByMonth = {
      "2026-08": 120_000,
      "2026-09": -20_000, // loss, never declared
      "2026-10": 0,
    };

    const result = await computeCarryForward(2026, 11);

    assert.equal(result.amount, -20_000);
    assert.equal(result.rows.length, 1, "a zero-profit month must not create a row");
    assert.deepEqual(
      result.rows.map((row) => [row.year, row.month, row.kind, row.amount]),
      [[2026, 9, "UNDECLARED", -20_000]],
    );
    assert.deepEqual(
      aggregateCalls,
      ["2026-08", "2026-09", "2026-10"],
      "the target month itself is never included",
    );
  },
);

test(
  "rolls only the delta forward when a declared month is restated",
  { skip: moduleMocksUnavailable },
  async () => {
    resetFixtures();
    earliestActive = { periodYear: 2026, periodMonth: 7 };
    activeRows = [{ periodYear: 2026, periodMonth: 7, snapshotNetProfit: 120_000 }];
    // A credit note against a July sale rebuilt FactProfit after the fact.
    netProfitByMonth = { "2026-07": 108_000 };

    const result = await computeCarryForward(2026, 8);

    assert.equal(result.amount, -12_000, "only the difference rolls on, not the whole month");
    assert.deepEqual(
      result.rows.map((row) => [row.year, row.month, row.kind, row.amount]),
      [[2026, 7, "RESTATED", -12_000]],
    );
  },
);

test(
  "combines undeclared and restated months without double counting",
  { skip: moduleMocksUnavailable },
  async () => {
    resetFixtures();
    earliestActive = { periodYear: 2026, periodMonth: 8 };
    activeRows = [
      { periodYear: 2026, periodMonth: 8, snapshotNetProfit: 100_000 },
      { periodYear: 2026, periodMonth: 10, snapshotNetProfit: 50_000 },
    ];
    netProfitByMonth = {
      "2026-08": 95_000, // restated  → -5,000
      "2026-09": -8_000, // undeclared loss → -8,000
      "2026-10": 50_000, // declared, unchanged → 0
      "2026-11": 30_000, // undeclared profit (skipped month) → +30,000
    };

    const result = await computeCarryForward(2026, 12);

    assert.equal(result.amount, 17_000);
    assert.deepEqual(
      result.rows.map((row) => [row.month, row.kind, row.amount]),
      [
        [8, "RESTATED", -5_000],
        [9, "UNDECLARED", -8_000],
        [11, "UNDECLARED", 30_000],
      ],
      "a declared month that has not moved contributes no row at all",
    );
  },
);

test(
  "treats a cancelled month as undeclared and rolls its whole profit forward",
  { skip: moduleMocksUnavailable },
  async () => {
    resetFixtures();
    earliestActive = { periodYear: 2026, periodMonth: 8 };
    // September's document was cancelled, so it is absent from the ACTIVE rows.
    activeRows = [{ periodYear: 2026, periodMonth: 8, snapshotNetProfit: 40_000 }];
    netProfitByMonth = { "2026-08": 40_000, "2026-09": 75_000 };

    const result = await computeCarryForward(2026, 10);

    assert.equal(result.amount, 75_000);
    assert.deepEqual(
      result.rows.map((row) => [row.month, row.kind]),
      [[9, "UNDECLARED"]],
    );
  },
);

test(
  "caps the lookback at 36 months even when the first document is older",
  { skip: moduleMocksUnavailable },
  async () => {
    resetFixtures();
    // First document far enough back that the 36-month window binds before the
    // July 2026 start floor does.
    earliestActive = { periodYear: 2026, periodMonth: 8 };
    activeRows = [];
    netProfitByMonth = {};

    const result = await computeCarryForward(2031, 1);

    assert.equal(aggregateCalls.length, 36, "lookback window must stay bounded");
    assert.equal(aggregateCalls[0], "2028-01", "oldest month scanned is target − 36 months");
    assert.equal(aggregateCalls.at(-1), "2030-12", "newest month scanned is the month before target");
    assert.equal(result.amount, 0);
  },
);

test(
  "walks periods across a year boundary",
  { skip: moduleMocksUnavailable },
  async () => {
    resetFixtures();
    earliestActive = { periodYear: 2026, periodMonth: 11 };
    activeRows = [];
    netProfitByMonth = { "2026-11": 10_000, "2026-12": -4_000 };

    const result = await computeCarryForward(2027, 1);

    assert.deepEqual(aggregateCalls, ["2026-11", "2026-12"]);
    assert.equal(result.amount, 6_000);
  },
);

test(
  "rounds sub-satang noise away instead of emitting phantom rows",
  { skip: moduleMocksUnavailable },
  async () => {
    resetFixtures();
    earliestActive = { periodYear: 2026, periodMonth: 7 };
    activeRows = [{ periodYear: 2026, periodMonth: 7, snapshotNetProfit: 120_000 }];
    // Floating-point drift far below one satang must not look like a restatement.
    netProfitByMonth = { "2026-07": 120_000.000_000_1 };

    const result = await computeCarryForward(2026, 8);

    assert.equal(result.amount, 0);
    assert.deepEqual(result.rows, []);
  },
);

test(
  "getPeriodBounds spans the whole month in Thailand time",
  { skip: moduleMocksUnavailable },
  async () => {
    // Thailand is UTC+7, so a month starts at 17:00 UTC on the last day prior.
    const july = getPeriodBounds(2026, 7);
    assert.equal(july.start.toISOString(), "2026-06-30T17:00:00.000Z");
    assert.equal(july.end.toISOString(), "2026-07-31T16:59:59.999Z");

    // Leap year February must include the 29th.
    const february = getPeriodBounds(2028, 2);
    assert.equal(february.start.toISOString(), "2028-01-31T17:00:00.000Z");
    assert.equal(february.end.toISOString(), "2028-02-29T16:59:59.999Z");

    // Non-leap February stops at the 28th.
    const shortFebruary = getPeriodBounds(2026, 2);
    assert.equal(shortFebruary.end.toISOString(), "2026-02-28T16:59:59.999Z");

    // December must not roll the year over.
    const december = getPeriodBounds(2026, 12);
    assert.equal(december.end.toISOString(), "2026-12-31T16:59:59.999Z");
  },
);

test(
  "rolls a retained balance forward when the month chose CARRY_FORWARD",
  { skip: moduleMocksUnavailable },
  async () => {
    resetFixtures();
    earliestActive = { periodYear: 2026, periodMonth: 7 };
    // Base 10,000, only 6,000 shared out, the rest deliberately kept for next month.
    activeRows = [
      {
        periodYear: 2026,
        periodMonth: 7,
        snapshotNetProfit: 10_000,
        distributedAmount: 6_000,
        retainedAmount: 4_000,
        retainedMode: "CARRY_FORWARD",
      },
    ];
    netProfitByMonth = { "2026-07": 10_000 };

    const result = await computeCarryForward(2026, 8);

    assert.equal(result.amount, 4_000);
    assert.deepEqual(
      result.rows.map((row) => [row.month, row.kind, row.amount]),
      [[7, "RETAINED", 4_000]],
    );
  },
);

test(
  "keeps a retained balance out of the next month when it chose KEEP_IN_SHOP",
  { skip: moduleMocksUnavailable },
  async () => {
    resetFixtures();
    earliestActive = { periodYear: 2026, periodMonth: 7 };
    activeRows = [
      {
        periodYear: 2026,
        periodMonth: 7,
        snapshotNetProfit: 10_000,
        distributedAmount: 6_000,
        retainedAmount: 4_000,
        retainedMode: "KEEP_IN_SHOP",
      },
    ];
    netProfitByMonth = { "2026-07": 10_000 };

    const result = await computeCarryForward(2026, 8);

    assert.equal(result.amount, 0, "money kept in the shop never returns to the pool");
    assert.deepEqual(result.rows, []);
  },
);

test(
  "adds a restated delta on top of a carried retained balance",
  { skip: moduleMocksUnavailable },
  async () => {
    resetFixtures();
    earliestActive = { periodYear: 2026, periodMonth: 7 };
    activeRows = [
      {
        periodYear: 2026,
        periodMonth: 7,
        snapshotNetProfit: 10_000,
        distributedAmount: 6_000,
        retainedAmount: 4_000,
        retainedMode: "CARRY_FORWARD",
      },
    ];
    // A credit note rebuilt July after the fact: 10,000 -> 8,500.
    netProfitByMonth = { "2026-07": 8_500 };

    const result = await computeCarryForward(2026, 8);

    assert.equal(result.amount, 2_500, "8,500 earned minus the 6,000 actually paid out");
    assert.deepEqual(
      result.rows.map((row) => [row.month, row.kind, row.amount]),
      [[7, "RESTATED", 2_500]],
      "the restatement is what makes this month notable, but the amount is the whole balance",
    );
  },
);

test(
  "an unbroken chain deducts a loss month exactly once",
  { skip: moduleMocksUnavailable },
  async () => {
    resetFixtures();
    earliestActive = { periodYear: 2026, periodMonth: 7 };
    // The regression this whole rule exists for: August lost 20,000 and was
    // declared as a zero document that carried its loss on. September absorbed
    // it. October must start clean instead of being charged the same 20,000.
    activeRows = [
      { periodYear: 2026, periodMonth: 7, snapshotNetProfit: 100_000 },
      {
        periodYear: 2026,
        periodMonth: 8,
        snapshotNetProfit: -20_000,
        distributedAmount: 0,
        retainedAmount: -20_000,
        retainedMode: "CARRY_FORWARD",
      },
      // Base 30,000 (50,000 earned less August's 20,000 loss), all of it shared.
      { periodYear: 2026, periodMonth: 9, snapshotNetProfit: 50_000, distributedAmount: 30_000 },
    ];
    netProfitByMonth = { "2026-07": 100_000, "2026-08": -20_000, "2026-09": 50_000 };

    const september = await computeCarryForward(2026, 9);
    assert.equal(september.amount, -20_000, "September carries the loss once");

    const october = await computeCarryForward(2026, 10);
    assert.equal(october.amount, 0, "October must not be charged the same loss again");
    // The breakdown is a decomposition of that zero, not a list of open items:
    // August is still short 20,000 and September earned 20,000 more than it
    // shared out precisely because it covered August. They cancel.
    assert.deepEqual(
      october.rows.map((row) => [row.month, row.amount]),
      [
        [8, -20_000],
        [9, 20_000],
      ],
    );
    assert.equal(
      roundTo2(october.rows.reduce((sum, row) => sum + row.amount, 0)),
      0,
      "the rows must always add up to the carried amount",
    );
  },
);

test(
  "listUndeclaredPriorPeriods returns every closed in-scope gap, oldest first",
  { skip: moduleMocksUnavailable },
  async () => {
    resetFixtures();
    const current = getCurrentPeriod();

    const result = await listUndeclaredPriorPeriods(current.year, current.month);

    assert.ok(result.length > 0, "nothing has been declared, so every closed month is a gap");
    assert.deepEqual(
      [result[0].year, result[0].month],
      [startPeriod.year, startPeriod.month],
      "the list starts at the month the arrangement began",
    );
    const last = result[result.length - 1];
    assert.equal(isClosedPeriod(last.year, last.month), true, "open months are never listed");

    // Strictly ascending and contiguous — the UI declares them in this order.
    for (let index = 1; index < result.length; index += 1) {
      const previous = result[index - 1];
      const expected =
        previous.month === 12
          ? { year: previous.year + 1, month: 1 }
          : { year: previous.year, month: previous.month + 1 };
      assert.deepEqual([result[index].year, result[index].month], [expected.year, expected.month]);
    }
  },
);

test(
  "listUndeclaredPriorPeriods returns nothing once the chain is complete",
  { skip: moduleMocksUnavailable },
  async () => {
    resetFixtures();
    const current = getCurrentPeriod();
    const gaps = await listUndeclaredPriorPeriods(current.year, current.month);
    // Declare every one of them, then ask again.
    activeRows = gaps.map((gap) => ({
      periodYear: gap.year,
      periodMonth: gap.month,
      snapshotNetProfit: 0,
    }));

    const result = await listUndeclaredPriorPeriods(current.year, current.month);

    assert.deepEqual(result, []);
  },
);

test(
  "listUndeclaredPriorPeriods ignores months before the arrangement started",
  { skip: moduleMocksUnavailable },
  async () => {
    resetFixtures();

    const result = await listUndeclaredPriorPeriods(startPeriod.year, startPeriod.month);

    assert.deepEqual(result, [], "the very first period has nothing before it in scope");
  },
);
