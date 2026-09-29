import assert from "node:assert/strict";
import test, { after, before, mock } from "node:test";
import { PGlite } from "@electric-sql/pglite";

type Balance = { productId: string; lotNo: string; qtyOnHand: number };
type Lot = { productId: string; lotNo: string; expDate: Date | null };
type Sql = { text: string; values: unknown[] };
const PAGE_SIZE = 50;
const THRESHOLD = new Date("2026-10-29T00:00:00+07:00");
const moduleMocksUnavailable = typeof (mock as { module?: unknown }).module !== "function"
  && "requires --experimental-test-module-mocks";
const balances: Balance[] = [];
const lots: Lot[] = [];
let pg: PGlite;
let returnedRows = 0;
let lastQuery: Sql;

function add(productId: string, lotNo: string, qtyOnHand: number, expDate: Date | null): void {
  balances.push({ productId, lotNo, qtyOnHand });
  lots.push({ productId, lotNo, expDate });
}

// A fixed corpus crosses the old 1000-key chunk boundary and includes lot
// numbers whose database locale/UTF-8 order differs from JavaScript UTF-16.
for (let index = 0; index < 1203; index += 1) {
  const productId = `p${String(index % 7).padStart(2, "0")}`;
  const expiry = new Date(THRESHOLD.getTime() + (index % 5 - 2) * 86_400_000);
  add(productId, `LOT-${String(index).padStart(4, "0")}`, 1 + index % 4 / 4, expiry);
}
add("p01", "shared", 2.5, THRESHOLD);
add("p02", "shared", 0, THRESHOLD);
add("p03", "shared", -1, THRESHOLD);
add("p04", "no-exp", 10, null);
add("p05", "no-balance", 0, THRESHOLD);
add("p00", "boundary-after", 1, new Date(THRESHOLD.getTime() + 1));
for (const lotNo of ["a", "A", "ก", "😀", "\uE000", "", "a' OR true --"]) {
  add("p00", lotNo, 1.125, THRESHOLD);
}
lots.push({ productId: "orphan", lotNo: "shared", expDate: THRESHOLD });
balances.push({ productId: "orphan", lotNo: "missing-lot", qtyOnHand: 2 });

// Frozen pre-change algorithm: read all positive balances, look up exact lot
// keys, filter, sort in JavaScript and only then slice the requested page.
function legacy(threshold: Date | undefined, page: number) {
  const stock = new Map(balances.filter((row) => row.qtyOnHand > 0)
    .map((row) => [`${row.productId}:${row.lotNo}`, row.qtyOnHand]));
  const matching = lots.filter((row) => stock.has(`${row.productId}:${row.lotNo}`)
    && row.expDate !== null && (!threshold || row.expDate <= threshold))
    .map((row) => ({ ...row, qtyOnHand: stock.get(`${row.productId}:${row.lotNo}`)! }))
    .sort((a, b) => {
      const diff = a.expDate!.getTime() - b.expDate!.getTime();
      if (diff !== 0) return diff;
      if (a.productId !== b.productId) return a.productId < b.productId ? -1 : 1;
      return a.lotNo === b.lotNo ? 0 : a.lotNo < b.lotNo ? -1 : 1;
    });
  return {
    totalRows: matching.length,
    lots: matching.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
  };
}

before(async () => {
  if (moduleMocksUnavailable) return;
  pg = new PGlite();
  await pg.exec(`
    SET TIME ZONE 'UTC';
    CREATE TABLE "ProductLot" (
      "productId" TEXT NOT NULL, "lotNo" TEXT NOT NULL, "expDate" TIMESTAMPTZ(3),
      UNIQUE ("productId", "lotNo")
    );
    CREATE TABLE "LotBalance" (
      "productId" TEXT NOT NULL, "lotNo" TEXT NOT NULL, "qtyOnHand" NUMERIC(12,4),
      UNIQUE ("productId", "lotNo")
    );
  `);
  await pg.query(`INSERT INTO "ProductLot" SELECT * FROM json_to_recordset($1::json)
    AS x("productId" text, "lotNo" text, "expDate" timestamptz)`, [JSON.stringify(lots)]);
  await pg.query(`INSERT INTO "LotBalance" SELECT * FROM json_to_recordset($1::json)
    AS x("productId" text, "lotNo" text, "qtyOnHand" numeric)`, [JSON.stringify(balances)]);
  await mock.module("@/lib/db", { namedExports: { db: {
    $queryRaw: async (query: Sql): Promise<unknown[]> => {
      lastQuery = query;
      const result = await pg.query(query.text, query.values);
      returnedRows = result.rows.length;
      return result.rows;
    },
  } } });
});

after(async () => { await pg?.close(); });

for (const threshold of [undefined, THRESHOLD, new Date("2020-01-01T00:00:00Z")]) {
  for (const page of [1, 2, 16, 25, 26, 100, Number.NaN, Number.POSITIVE_INFINITY]) {
    test(`expiry SQL golden: threshold=${threshold?.toISOString() ?? "all"}, page=${page}`,
      { skip: moduleMocksUnavailable }, async () => {
        const { getLotExpiryPage } = await import("../lot-expiry-query");
        assert.deepEqual(await getLotExpiryPage(threshold, page, PAGE_SIZE), legacy(threshold, page));
        assert.ok(returnedRows <= PAGE_SIZE, "only the requested page crosses the DB boundary");
      });
  }
}

test("expiry query parameterizes threshold and paging and does not cap before filtering",
  { skip: moduleMocksUnavailable }, async () => {
    const { getLotExpiryPage } = await import("../lot-expiry-query");
    const result = await getLotExpiryPage(THRESHOLD, 1, PAGE_SIZE);
    assert.ok(result.totalRows > 1000 / 2);
    assert.ok(!lastQuery.text.includes(THRESHOLD.toISOString()));
    assert.deepEqual(lastQuery.values, [THRESHOLD.toISOString(), PAGE_SIZE, 0]);
    assert.equal((lastQuery.text.match(/LIMIT/g) ?? []).length, 1);
    assert.ok(!/\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b/.test(lastQuery.text));
  });
