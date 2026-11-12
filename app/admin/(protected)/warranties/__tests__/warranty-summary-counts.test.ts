import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { PGlite } from "@electric-sql/pglite";

import type { Prisma } from "@/lib/generated/prisma";
import { addThailandDays, parseDateOnlyToDate, parseDateOnlyToEndOfDay, parseDateOnlyToStartOfDay } from "@/lib/th-date";
import {
  buildWarrantySummaryCountsSql,
  toWarrantySummaryCounts,
  type WarrantySummaryCounts,
} from "../warranty-summary-counts";

/**
 * Golden check for the admin warranty list summary cards: the one-row COUNT FILTER query must
 * give the numbers the page used to compute by loading every Warranty row in the date range
 * and bucketing it in JS. `oldCounts` is that JS, copied from the previous page code.
 */

type FixtureRow = { id: string; status: "ACTIVE" | "CANCELLED"; startDate: Date; endDate: Date };

let pg: PGlite;

/** Same parameter handling as @prisma/adapter-pg: Dates go out as zone-less UTC strings. */
const toAdapterParam = (value: unknown): unknown =>
  value instanceof Date ? value.toISOString().replace("T", " ").replace("Z", "") : value;

const run = async <T>(sql: Prisma.Sql): Promise<T[]> => {
  const result = await pg.query<T>(sql.text, sql.values.map(toAdapterParam));
  return result.rows;
};

const MS = 1;
const DAY_MS = 24 * 60 * 60 * 1000;
const SOON_DAYS = 30;

const nowFor = (dateKey: string): Date => parseDateOnlyToDate(dateKey);

const oldCounts = (
  rows: readonly FixtureRow[],
  now: Date,
  soonDate: Date,
  from: string,
  to: string,
): WarrantySummaryCounts => {
  // dateWhere: startDate gte start-of-day(from), lte end-of-day(to), each only when set.
  const fromDate = from ? parseDateOnlyToStartOfDay(from) : null;
  const toDate = to ? parseDateOnlyToEndOfDay(to) : null;
  const summaryRows = rows.filter(
    (row) => (!fromDate || row.startDate >= fromDate) && (!toDate || row.startDate <= toDate),
  );
  return summaryRows.reduce(
    (acc, row) => {
      if (row.status === "CANCELLED") {
        acc.cancelled += 1;
      } else if (row.endDate < now) {
        acc.expired += 1;
      } else if (row.endDate <= soonDate) {
        acc.soon += 1;
      } else {
        acc.active += 1;
      }
      return acc;
    },
    { active: 0, soon: 0, expired: 0, cancelled: 0 },
  );
};

const newCounts = async (now: Date, soonDate: Date, from: string, to: string): Promise<WarrantySummaryCounts> =>
  toWarrantySummaryCounts(
    await run<WarrantySummaryCounts>(
      buildWarrantySummaryCountsSql({
        now,
        soonDate,
        startDateFrom: from ? parseDateOnlyToStartOfDay(from) : null,
        startDateTo: to ? parseDateOnlyToEndOfDay(to) : null,
      }),
    ),
  );

const NOW_KEYS = ["2026-11-12", "2026-12-01", "2027-01-15"] as const;

/** Rows on and around every bucket edge of every `now` tested, plus edges of the date range. */
const buildFixture = (): FixtureRow[] => {
  const rows: FixtureRow[] = [];
  const startDates = [
    parseDateOnlyToStartOfDay("2026-10-01"),
    new Date(parseDateOnlyToStartOfDay("2026-10-01").getTime() - MS),
    parseDateOnlyToEndOfDay("2026-10-31"),
    new Date(parseDateOnlyToEndOfDay("2026-10-31").getTime() + MS),
    parseDateOnlyToStartOfDay("2026-06-15"),
  ];
  let seq = 0;
  for (const key of NOW_KEYS) {
    const now = nowFor(key);
    const soon = addThailandDays(now, SOON_DAYS);
    const ends = [
      new Date(now.getTime() - MS),
      now,
      new Date(now.getTime() + MS),
      soon,
      new Date(soon.getTime() - MS),
      new Date(soon.getTime() + MS),
      new Date(now.getTime() - 400 * DAY_MS),
      new Date(soon.getTime() + 400 * DAY_MS),
    ];
    for (const endDate of ends) {
      for (const startDate of startDates) {
        for (const status of ["ACTIVE", "CANCELLED"] as const) {
          seq += 1;
          // Fewer cancelled rows than active ones, like real data.
          if (status === "CANCELLED" && seq % 3 !== 0) continue;
          rows.push({ id: `w${seq}`, status, startDate, endDate });
        }
      }
    }
  }
  return rows;
};

const fixture = buildFixture();

before(async () => {
  pg = new PGlite();
  await pg.exec(`
    SET TIME ZONE 'UTC';
    CREATE TYPE "WarrantyStatus" AS ENUM ('ACTIVE', 'CANCELLED');
    CREATE TABLE "Warranty" (
      id TEXT PRIMARY KEY,
      status "WarrantyStatus" NOT NULL DEFAULT 'ACTIVE',
      "startDate" TIMESTAMPTZ(3) NOT NULL,
      "endDate" TIMESTAMPTZ(3) NOT NULL
    );
  `);
  for (const row of fixture) {
    await pg.query(`INSERT INTO "Warranty" (id, status, "startDate", "endDate") VALUES ($1, $2, $3, $4)`, [
      row.id,
      row.status,
      row.startDate.toISOString(),
      row.endDate.toISOString(),
    ]);
  }
});

after(async () => {
  await pg?.close();
});

const RANGES: ReadonlyArray<readonly [string, string]> = [
  ["", ""],
  ["2026-10-01", ""],
  ["", "2026-10-31"],
  ["2026-10-01", "2026-10-31"],
  ["2026-10-31", "2026-10-31"],
  ["2027-01-01", "2027-01-31"],
];

test("summary counts equal the old per-row JS buckets for every now and date range", async () => {
  for (const key of NOW_KEYS) {
    const now = nowFor(key);
    const soonDate = addThailandDays(now, SOON_DAYS);
    for (const [from, to] of RANGES) {
      assert.deepEqual(
        await newCounts(now, soonDate, from, to),
        oldCounts(fixture, now, soonDate, from, to),
        `now=${key} from=${from || "-"} to=${to || "-"}`,
      );
    }
  }
});

test("the fixture hits every bucket, including the exact edges (== now is soon, == soonDate is soon, +1ms is active)", async () => {
  const now = nowFor("2026-11-12");
  const soonDate = addThailandDays(now, SOON_DAYS);
  const all = await newCounts(now, soonDate, "", "");
  for (const value of Object.values(all)) assert.ok(value > 0);
  const startDate = parseDateOnlyToStartOfDay("2026-06-15");
  const bucketOf = (endDate: Date): WarrantySummaryCounts =>
    oldCounts([{ id: "x", status: "ACTIVE", startDate, endDate }], now, soonDate, "", "");
  assert.equal(bucketOf(new Date(now.getTime() - MS)).expired, 1);
  assert.equal(bucketOf(now).soon, 1);
  assert.equal(bucketOf(soonDate).soon, 1);
  assert.equal(bucketOf(new Date(soonDate.getTime() + MS)).active, 1);
  const edgeRows = fixture.filter((row) => row.endDate.getTime() === now.getTime() || row.endDate.getTime() === soonDate.getTime());
  assert.ok(edgeRows.length > 0);
});

test("no rows gives four zeros, as numbers", async () => {
  const now = nowFor("2026-11-12");
  const counts = await newCounts(now, addThailandDays(now, SOON_DAYS), "2030-01-01", "2030-01-31");
  assert.deepEqual(counts, { active: 0, soon: 0, expired: 0, cancelled: 0 });
  for (const value of Object.values(counts)) assert.equal(typeof value, "number");
});

test("the SQL binds every date as a parameter and adds no date filter when the range is empty", () => {
  const now = nowFor("2026-11-12");
  const soonDate = addThailandDays(now, SOON_DAYS);
  const noRange = buildWarrantySummaryCountsSql({ now, soonDate, startDateFrom: null, startDateTo: null });
  assert.doesNotMatch(noRange.text, /WHERE w\."startDate"/);
  assert.ok(noRange.values.every((value) => value instanceof Date));
  const ranged = buildWarrantySummaryCountsSql({
    now,
    soonDate,
    startDateFrom: parseDateOnlyToStartOfDay("2026-10-01"),
    startDateTo: parseDateOnlyToEndOfDay("2026-10-31"),
  });
  assert.match(ranged.text, /WHERE w\."startDate" >= \$\d+ AND w\."startDate" <= \$\d+/);
});
