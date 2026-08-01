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
 * Two disjoint sources must be combined, and never double-counted:
 *   UNDECLARED — a closed month with no ACTIVE distribution (loss month, or one
 *                that was skipped or cancelled): its whole net profit rolls on.
 *   RESTATED   — a month that WAS distributed but whose FactProfit total has
 *                since been rebuilt: only the delta against the stored snapshot
 *                rolls on, so closed documents are never rewritten.
 *
 * Two hard floors apply: nothing rolls forward from before the very first
 * distribution (the shop starts with no opening balances), and nothing ever
 * rolls forward from before PROFIT_DISTRIBUTION_START_PERIOD (July 2026) —
 * the losses booked before the partners started sharing profit are written off.
 *
 * The mocks are registered ONCE (mock.module cannot re-mock a module within a
 * run) and read from mutable state so each test can vary the fixtures.
 */

type ActiveDistributionRow = {
  periodYear: number;
  periodMonth: number;
  snapshotNetProfit: number;
};

type PeriodRef = { periodYear: number; periodMonth: number };

type FindManyArgs = { where?: { OR?: PeriodRef[] } };

let earliestActive: PeriodRef | null = null;
let activeRows: ActiveDistributionRow[] = [];
/** Net profit per "YYYY-MM" as FactProfit would report it *today*. */
let netProfitByMonth: Record<string, number> = {};
let aggregateCalls: string[] = [];

function periodKeyOf(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

type ProfitDistributionModule = typeof import("@/lib/profit-distribution");

let computeCarryForward: ProfitDistributionModule["computeCarryForward"];
let getPeriodBounds: ProfitDistributionModule["getPeriodBounds"];
let isBeforeStartPeriod: ProfitDistributionModule["isBeforeStartPeriod"];
let startPeriod: ProfitDistributionModule["PROFIT_DISTRIBUTION_START_PERIOD"];

before(async () => {
  if (moduleMocksUnavailable) return;

  const { getThailandMonthKey } = await import("@/lib/th-date");

  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        profitDistribution: {
          findFirst: async () => earliestActive,
          // Faithful to the real query: only periods listed in `where.OR` come back.
          findMany: async (args: FindManyArgs) => {
            const wanted = new Set(
              (args.where?.OR ?? []).map((item) =>
                periodKeyOf(item.periodYear, item.periodMonth),
              ),
            );
            return activeRows.filter((row) =>
              wanted.has(periodKeyOf(row.periodYear, row.periodMonth)),
            );
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
