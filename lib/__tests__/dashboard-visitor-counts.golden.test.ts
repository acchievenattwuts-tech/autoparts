import assert from "node:assert/strict";
import test, { after, before, mock } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { Prisma } from "@/lib/generated/prisma";

/**
 * R5 (review 2026-11-12): the daily dashboard's "เดือนนี้ | สะสม" visitor numbers used two
 * `storefrontVisitDaily.findMany({ distinct: ["visitorKey"] })` reads and took `.length` in Node
 * (Prisma de-duplicates in memory). countStorefrontVisitors() now runs one COUNT(DISTINCT) statement.
 * This test runs that exact SQL against an in-process Postgres (PGlite) and compares it with the old
 * algorithm — the same rows filtered the same way, then de-duplicated in JS — on keys that differ only
 * by case, whitespace or Thai characters, and on visits before the month, inside it and after today.
 */
const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" && "requires --experimental-test-module-mocks";

let pg: PGlite;

const db = {
  $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> => {
    const query = Prisma.sql(strings, ...values);
    return (await pg.query(query.text, query.values)).rows;
  },
};

const VISITS: Array<[visitorKey: string, visitDay: string]> = [
  ["v-a", "2026-10-30"], ["v-a", "2026-11-01"], ["v-a", "2026-11-12"],
  ["v-b", "2026-11-05"], ["V-B", "2026-11-05"], ["v-b ", "2026-11-06"],
  ["ผู้ชม-1", "2026-11-12"], ["ผู้ชม-1", "2026-11-11"], ["ผู้ชม-2", "2026-09-01"],
  ["v-old", "2026-05-17"], ["v-old", "2026-10-31"], ["v-future", "2026-11-13"],
  ["v-edge-start", "2026-11-01"], ["v-edge-end", "2026-11-12"], ["v-c", "2026-11-1"],
];

/** The previous read: every matching visitorKey, de-duplicated in memory like Prisma's distinct. */
async function oldDistinctLength(range: { gte: string; lte: string } | null): Promise<number> {
  const result = range
    ? await pg.query<{ visitorKey: string }>(
        `SELECT "visitorKey" FROM "StorefrontVisitDaily" WHERE "visitDay" >= $1 AND "visitDay" <= $2`,
        [range.gte, range.lte],
      )
    : await pg.query<{ visitorKey: string }>(`SELECT "visitorKey" FROM "StorefrontVisitDaily"`);
  return new Set(result.rows.map((row) => row.visitorKey)).size;
}

let countStorefrontVisitors: typeof import("@/lib/dashboard-visitor-counts").countStorefrontVisitors;

before(async () => {
  if (moduleMocksUnavailable) return;
  pg = new PGlite();
  await pg.exec(`
    CREATE TABLE "StorefrontVisitDaily" (
      "id" TEXT PRIMARY KEY,
      "visitorKey" TEXT NOT NULL,
      "visitDay" TEXT NOT NULL,
      UNIQUE ("visitorKey", "visitDay")
    );
  `);
  for (const [index, [visitorKey, visitDay]] of VISITS.entries()) {
    await pg.query(`INSERT INTO "StorefrontVisitDaily" ("id", "visitorKey", "visitDay") VALUES ($1, $2, $3)`,
      [`visit-${index}`, visitorKey, visitDay]);
  }
  await mock.module("@/lib/db", { namedExports: { db } });
  ({ countStorefrontVisitors } = await import("@/lib/dashboard-visitor-counts"));
});

after(async () => {
  await pg?.close();
});

test("one COUNT(DISTINCT) statement returns the same month and total as the two distinct reads", { skip: moduleMocksUnavailable }, async () => {
  for (const [monthStart, today] of [["2026-11-01", "2026-11-12"], ["2026-10-01", "2026-10-31"], ["2026-12-01", "2026-12-03"]]) {
    const counts = await countStorefrontVisitors(monthStart, today);
    assert.deepEqual(counts, {
      month: await oldDistinctLength({ gte: monthStart, lte: today }),
      total: await oldDistinctLength(null),
    }, `${monthStart}..${today}`);
  }
  // v-a, v-b, V-B, "v-b ", ผู้ชม-1, v-edge-start, v-edge-end and v-c ("2026-11-1" sorts inside the range as text).
  assert.deepEqual(await countStorefrontVisitors("2026-11-01", "2026-11-12"), { month: 8, total: 11 });
});

test("an empty table counts zero visitors, as the empty lists did", { skip: moduleMocksUnavailable }, async () => {
  await pg.exec(`CREATE TEMP TABLE visit_backup AS SELECT * FROM "StorefrontVisitDaily"; DELETE FROM "StorefrontVisitDaily";`);
  try {
    assert.deepEqual(await countStorefrontVisitors("2026-11-01", "2026-11-12"), { month: 0, total: 0 });
  } finally {
    await pg.exec(`INSERT INTO "StorefrontVisitDaily" SELECT * FROM visit_backup; DROP TABLE visit_backup;`);
  }
});
