import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { PGlite } from "@electric-sql/pglite";

import type { Prisma } from "@/lib/generated/prisma";
import {
  buildPutAwayCountSql,
  buildPutAwayListSql,
  buildPutAwayQuery,
  buildPutAwaySuggestionSql,
  parsePutAwayFilters,
  pickPutAwaySuggestion,
  type PutAwayQueueInput,
  type PutAwaySuggestionRow,
  type PutAwayTab,
} from "@/lib/shelf-put-away";

/**
 * The queue SQL runs against an in-process Postgres (PGlite) with the columns it reads,
 * so the Thailand-day comparison and the tab rules are checked as Postgres evaluates them.
 */

let pg: PGlite;

/** Same parameter handling as @prisma/adapter-pg: Dates go out as zone-less UTC strings. */
const toAdapterParam = (value: unknown): unknown =>
  value instanceof Date ? value.toISOString().replace("T", " ").replace("Z", "") : value;

const run = async <T>(sql: Prisma.Sql): Promise<T[]> => {
  const result = await pg.query<T>(sql.text, sql.values.map(toAdapterParam));
  return result.rows;
};

/** Thailand midnight of a date, the way purchase dates are stored (lib/th-date.ts). */
const thaiDate = (key: string): string => `'${key}T00:00:00+07:00'`;

before(async () => {
  pg = new PGlite();
  await pg.exec(`
    SET TIME ZONE 'UTC';
    CREATE TABLE "Product" (
      id TEXT PRIMARY KEY, code TEXT NOT NULL, "isActive" BOOLEAN NOT NULL, "inventoryTracking" TEXT NOT NULL,
      stock INTEGER NOT NULL, "purchaseLastDate" TIMESTAMPTZ(3), "categoryId" TEXT NOT NULL
    );
    CREATE TABLE "ShelfRack" (id TEXT PRIMARY KEY, code TEXT NOT NULL, levels INTEGER NOT NULL, "isActive" BOOLEAN NOT NULL);
    CREATE TABLE "ProductShelfLocation" (
      id TEXT PRIMARY KEY, "productId" TEXT NOT NULL, "rackId" TEXT NOT NULL, level INTEGER NOT NULL,
      "isPrimary" BOOLEAN NOT NULL, "verifiedAt" TIMESTAMPTZ(3)
    );
    CREATE TABLE "CarModel" (id TEXT PRIMARY KEY, "carBrandId" TEXT NOT NULL);
    CREATE TABLE "ProductFitment" ("productId" TEXT NOT NULL, "carModelId" TEXT NOT NULL, "fitmentType" TEXT NOT NULL);

    INSERT INTO "ShelfRack" VALUES ('rA', 'A', 4, true), ('rB', 'B', 3, true), ('rX', 'X', 2, false);
    INSERT INTO "CarModel" VALUES ('vigo', 'toyota'), ('dmax', 'isuzu');

    INSERT INTO "Product" VALUES
      ('p01', 'EV-01', true,  'TRACKED',     5, ${thaiDate("2026-10-20")}, 'evap'),
      ('p02', 'EV-02', true,  'TRACKED',     0, ${thaiDate("2026-10-20")}, 'evap'),
      ('p03', 'SV-01', true,  'NON_TRACKED', 5, ${thaiDate("2026-10-20")}, 'service'),
      ('p04', 'EV-04', false, 'TRACKED',     5, ${thaiDate("2026-10-20")}, 'evap'),
      ('p05', 'EV-05', true,  'TRACKED',     5, ${thaiDate("2026-10-20")}, 'evap'),
      ('p06', 'EV-06', true,  'TRACKED',     5, ${thaiDate("2026-10-20")}, 'evap'),
      ('p07', 'EV-07', true,  'TRACKED',     5, ${thaiDate("2026-10-20")}, 'evap'),
      ('p08', 'EV-08', true,  'TRACKED',     5, ${thaiDate("2026-10-18")}, 'evap'),
      ('p09', 'EV-09', true,  'TRACKED',     5, NULL,                       'evap'),
      ('p10', 'EV-10', true,  'TRACKED',     5, NULL,                       'evap'),
      ('p11', 'EV-11', true,  'TRACKED',     5, ${thaiDate("2026-10-19")}, 'evap');

    INSERT INTO "ProductShelfLocation" VALUES
      -- confirmed 19 Oct 10:00 Thai, received 20 Oct -> ask
      ('l05', 'p05', 'rA', 2, true,  '2026-10-19T03:00:00Z'),
      -- confirmed 20 Oct 15:00 Thai, received the same day -> not asked
      ('l06', 'p06', 'rA', 2, true,  '2026-10-20T08:00:00Z'),
      -- confirmed 20 Oct 01:30 Thai (still 19 Oct in UTC), received 20 Oct -> same Thai day, not asked
      ('l07', 'p07', 'rB', 1, true,  '2026-10-19T18:30:00Z'),
      -- never confirmed but received -> ask
      ('l08', 'p08', 'rB', 1, true,  NULL),
      -- located but never received -> not asked
      ('l09', 'p09', 'rA', 1, true,  '2026-10-01T03:00:00Z'),
      -- latest of two confirmations counts: overflow confirmed 21 Oct, received 19 Oct -> not asked
      ('l11a', 'p11', 'rA', 3, true,  '2026-10-01T03:00:00Z'),
      ('l11b', 'p11', 'rB', 2, false, '2026-10-21T03:00:00Z');
  `);
});

after(async () => {
  await pg?.close();
});

const noFilter: PutAwayQueueInput = { productIds: null, receivedFrom: "", receivedTo: "" };

const listIds = async (tab: PutAwayTab, input = noFilter): Promise<string[]> =>
  (await run<{ id: string }>(buildPutAwayListSql({ ...input, tab, take: 50, skip: 0 }))).map((row) => row.id);

test("unlocated tab: active, tracked, in stock and without a location; latest receipt first, never-received last", async () => {
  assert.deepEqual(await listIds("unlocated"), ["p01", "p10"]);
});

test("received tab compares Thailand days: later receipt asks, same Thai day does not", async () => {
  assert.deepEqual(await listIds("received"), ["p05", "p08"]);
});

test("counts match the lists", async () => {
  const [counts] = await run<{ unlocated: number; received: number }>(buildPutAwayCountSql(noFilter));
  assert.deepEqual({ ...counts }, { unlocated: 2, received: 2 });
});

test("received-date range is inclusive Thailand days; product ids narrow both tabs", async () => {
  const today = { productIds: null, receivedFrom: "2026-10-20", receivedTo: "2026-10-20" };
  assert.deepEqual(await listIds("unlocated", today), ["p01"]);
  assert.deepEqual(await listIds("received", today), ["p05"]);
  assert.deepEqual(await listIds("received", { ...noFilter, productIds: ["p08", "p01"] }), ["p08"]);
  const [counts] = await run<{ unlocated: number; received: number }>(
    buildPutAwayCountSql({ ...noFilter, productIds: ["p08", "p01"] }),
  );
  assert.deepEqual({ ...counts }, { unlocated: 1, received: 1 });
});

test("paging uses LIMIT/OFFSET in the same order", async () => {
  const second = await run<{ id: string }>(buildPutAwayListSql({ ...noFilter, tab: "unlocated", take: 1, skip: 1 }));
  assert.deepEqual(second.map((row) => row.id), ["p10"]);
});

test("suggestion rows group home locations by category and car brand, active racks only", async () => {
  await pg.exec(`
    INSERT INTO "Product" VALUES
      ('s1', 'S-1', true, 'TRACKED', 1, NULL, 'cond'), ('s2', 'S-2', true, 'TRACKED', 1, NULL, 'cond'),
      ('s3', 'S-3', true, 'TRACKED', 1, NULL, 'cond'), ('s4', 'S-4', true, 'TRACKED', 1, NULL, 'cond');
    INSERT INTO "ProductFitment" VALUES ('s1', 'vigo', 'DIRECT'), ('s2', 'vigo', 'DIRECT'), ('s3', 'dmax', 'DIRECT'), ('s4', 'dmax', 'DIRECT');
    INSERT INTO "ProductShelfLocation" VALUES
      ('ls1', 's1', 'rB', 3, true, NULL), ('ls2', 's2', 'rB', 3, true, NULL),
      ('ls3', 's3', 'rA', 1, true, NULL), ('ls4', 's4', 'rA', 1, true, NULL),
      ('ls4x', 's4', 'rX', 1, false, NULL);
  `);
  const rows = await run<PutAwaySuggestionRow>(buildPutAwaySuggestionSql(["cond"]));
  const byBrand = rows.filter((row) => row.byCarBrand).map((row) => `${row.carBrandId}:${row.rackCode}-${row.level}:${row.products}`);
  const byCategory = rows.filter((row) => !row.byCarBrand).map((row) => `${row.rackCode}-${row.level}:${row.products}`);
  assert.deepEqual(byBrand.sort(), ["isuzu:A-1:2", "toyota:B-3:2"]);
  assert.deepEqual(byCategory.sort(), ["A-1:2", "B-3:2"]);
});

const suggestionRows: PutAwaySuggestionRow[] = [
  { categoryId: "cond", carBrandId: "toyota", byCarBrand: true, rackId: "rB", rackCode: "B", level: 3, products: 12 },
  { categoryId: "cond", carBrandId: "isuzu", byCarBrand: true, rackId: "rA", rackCode: "A", level: 1, products: 4 },
  { categoryId: "cond", carBrandId: null, byCarBrand: false, rackId: "rB", rackCode: "B", level: 3, products: 12 },
  { categoryId: "cond", carBrandId: null, byCarBrand: false, rackId: "rA", rackCode: "A", level: 2, products: 20 },
];
const carBrandNames = new Map([["toyota", "Toyota"], ["isuzu", "Isuzu"]]);

test("suggestion prefers the same category and car brand, else the busiest home of the category", () => {
  const product = { categoryId: "cond", categoryName: "คอยล์เย็น" };
  assert.deepEqual(pickPutAwaySuggestion({ ...product, carBrandIds: ["toyota"] }, suggestionRows, carBrandNames), {
    rackId: "rB",
    level: 3,
    code: "B-3",
    reason: "คอยล์เย็น · Toyota 12 รายการ",
  });
  assert.equal(pickPutAwaySuggestion({ ...product, carBrandIds: ["mazda"] }, suggestionRows, carBrandNames)?.code, "A-2");
  assert.equal(pickPutAwaySuggestion({ ...product, carBrandIds: [] }, suggestionRows, carBrandNames)?.reason, "คอยล์เย็น 20 รายการ");
  assert.equal(pickPutAwaySuggestion({ categoryId: "other", categoryName: "อื่น", carBrandIds: [] }, suggestionRows, carBrandNames), null);
});

test("filters parse defensively and the query string round-trips", () => {
  const filters = parsePutAwayFilters({
    tab: "received",
    q: " vigo ",
    categoryId: ["c1", "c2"],
    from: "2026-10-20",
    to: "20/10/2026",
    page: "3",
  });
  assert.equal(filters.tab, "received");
  assert.equal(filters.q, "vigo");
  assert.deepEqual(filters.categoryIds, ["c1", "c2"]);
  assert.equal(filters.receivedFrom, "2026-10-20");
  assert.equal(filters.receivedTo, "");
  assert.equal(filters.page, 3);
  const roundTrip: Record<string, string[]> = {};
  for (const [key, value] of new URLSearchParams(buildPutAwayQuery(filters))) (roundTrip[key] ??= []).push(value);
  assert.deepEqual(parsePutAwayFilters(roundTrip), filters);
  assert.equal(buildPutAwayQuery(parsePutAwayFilters({})), "");
  assert.equal(parsePutAwayFilters({ tab: "anything", page: "-2" }).tab, "unlocated");
  assert.equal(parsePutAwayFilters({ page: "-2" }).page, 1);
});
