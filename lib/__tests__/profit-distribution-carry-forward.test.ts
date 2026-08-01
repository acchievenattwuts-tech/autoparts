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
 * Nothing rolls forward before the very first distribution, because the shop
 * starts with no opening balances.
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

type ComputeCarryForward = typeof import("@/lib/profit-distribution").computeCarryForward;
type GetPeriodBounds = typeof import("@/lib/profit-distribution").getPeriodBounds;

let computeCarryForward: ComputeCarryForward;
let getPeriodBounds: GetPeriodBounds;

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
});

function resetFixtures(): void {
  earliestActive = null;
  activeRows = [];
  netProfitByMonth = {};
  aggregateCalls = [];
}

test(
  "carries nothing forward until the first distribution exists",
  { skip: moduleMocksUnavailable },
  async () => {
    resetFixtures();
    // A full year of profit sits in FactProfit, but none of it was ever declared.
    netProfitByMonth = { "2026-05": 120_000, "2026-06": 90_000, "2026-07": 80_000 };

    const result = await computeCarryForward(2026, 8);

    assert.equal(result.amount, 0, "no opening balances means history is ignored");
    assert.deepEqual(result.rows, []);
    assert.deepEqual(aggregateCalls, [], "must not scan FactProfit before the first document");
  },
);

test(
  "rolls a loss month forward so the next month may distribute less",
  { skip: moduleMocksUnavailable },
  async () => {
    resetFixtures();
    earliestActive = { periodYear: 2026, periodMonth: 5 };
    // May was declared and its snapshot still matches — it contributes nothing.
    activeRows = [{ periodYear: 2026, periodMonth: 5, snapshotNetProfit: 120_000 }];
    netProfitByMonth = {
      "2026-05": 120_000,
      "2026-06": -20_000, // loss, never declared
      "2026-07": 0,
    };

    const result = await computeCarryForward(2026, 8);

    assert.equal(result.amount, -20_000);
    assert.equal(result.rows.length, 1, "a zero-profit month must not create a row");
    assert.deepEqual(
      result.rows.map((row) => [row.year, row.month, row.kind, row.amount]),
      [[2026, 6, "UNDECLARED", -20_000]],
    );
    assert.deepEqual(
      aggregateCalls,
      ["2026-05", "2026-06", "2026-07"],
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
    earliestActive = { periodYear: 2026, periodMonth: 4 };
    activeRows = [
      { periodYear: 2026, periodMonth: 4, snapshotNetProfit: 100_000 },
      { periodYear: 2026, periodMonth: 6, snapshotNetProfit: 50_000 },
    ];
    netProfitByMonth = {
      "2026-04": 95_000, // restated  → -5,000
      "2026-05": -8_000, // undeclared loss → -8,000
      "2026-06": 50_000, // declared, unchanged → 0
      "2026-07": 30_000, // undeclared profit (skipped month) → +30,000
    };

    const result = await computeCarryForward(2026, 8);

    assert.equal(result.amount, 17_000);
    assert.deepEqual(
      result.rows.map((row) => [row.month, row.kind, row.amount]),
      [
        [4, "RESTATED", -5_000],
        [5, "UNDECLARED", -8_000],
        [7, "UNDECLARED", 30_000],
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
    earliestActive = { periodYear: 2026, periodMonth: 6 };
    // July's document was cancelled, so it is absent from the ACTIVE rows.
    activeRows = [{ periodYear: 2026, periodMonth: 6, snapshotNetProfit: 40_000 }];
    netProfitByMonth = { "2026-06": 40_000, "2026-07": 75_000 };

    const result = await computeCarryForward(2026, 8);

    assert.equal(result.amount, 75_000);
    assert.deepEqual(
      result.rows.map((row) => [row.month, row.kind]),
      [[7, "UNDECLARED"]],
    );
  },
);

test(
  "caps the lookback at 36 months even when the first document is older",
  { skip: moduleMocksUnavailable },
  async () => {
    resetFixtures();
    // First document 40 months before the target period.
    earliestActive = { periodYear: 2023, periodMonth: 4 };
    activeRows = [];
    netProfitByMonth = {};

    const result = await computeCarryForward(2026, 8);

    assert.equal(aggregateCalls.length, 36, "lookback window must stay bounded");
    assert.equal(aggregateCalls[0], "2023-08", "oldest month scanned is target − 36 months");
    assert.equal(aggregateCalls.at(-1), "2026-07", "newest month scanned is the month before target");
    assert.equal(result.amount, 0);
  },
);

test(
  "walks periods across a year boundary",
  { skip: moduleMocksUnavailable },
  async () => {
    resetFixtures();
    earliestActive = { periodYear: 2025, periodMonth: 11 };
    activeRows = [];
    netProfitByMonth = { "2025-11": 10_000, "2025-12": -4_000 };

    const result = await computeCarryForward(2026, 1);

    assert.deepEqual(aggregateCalls, ["2025-11", "2025-12"]);
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
