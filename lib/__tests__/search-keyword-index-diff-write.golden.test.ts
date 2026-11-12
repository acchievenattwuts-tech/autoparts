import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { PGlite, type Transaction } from "@electric-sql/pglite";

import { Prisma } from "@/lib/generated/prisma";

/**
 * Golden test for the SearchKeyword rebuild that writes only changed rows.
 *
 * Two in-process Postgres databases (PGlite) start from the same table. One is
 * rebuilt with the previous SQL (upsert every row with a fresh updatedAt, then
 * delete rows older than the run), the other with the current
 * runSearchKeywordRefreshWithDeps(). After every round, every column the app reads
 * (term, normalized, kind, sublabel, popularity) must match, and ids/createdAt of
 * rows that already existed must be preserved the same way. A repeat run with the
 * same rows must not write a single tuple.
 */

type DraftRow = {
  term: string;
  normalized: string;
  kind: "category" | "partsBrand" | "carBrand" | "carModel" | "product" | "synonym";
  sublabel: string | null;
  popularity: number;
};

type TableRow = {
  id: string;
  term: string;
  normalized: string;
  kind: string;
  sublabel: string | null;
  popularity: number;
  createdAt: Date;
  updatedAt: Date;
};

type PhysicalRow = { normalized: string; kind: string; xmin: string; ctid: string };

const BATCH_SIZE = 2;
const SEEDED_AT = "2026-11-01T00:00:00.000Z";
/** Written by another writer (or a run with a fast clock) after round 1 starts. */
const FUTURE_AT = "2026-11-10T00:05:00.000Z";
const ROUND_1_AT = new Date("2026-11-10T00:00:00.000Z");
const ROUND_2_AT = new Date("2026-11-11T00:00:00.000Z");
const ROUND_3_AT = new Date("2026-11-12T00:00:00.000Z");

const SCHEMA = `
  SET TIME ZONE 'UTC';
  CREATE TABLE "SearchKeyword" (
    "id" TEXT PRIMARY KEY,
    "term" VARCHAR(120) NOT NULL,
    "normalized" VARCHAR(120) NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "sublabel" VARCHAR(120),
    "popularity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE UNIQUE INDEX "SearchKeyword_normalized_kind_key" ON "SearchKeyword" ("normalized", "kind");
  INSERT INTO "SearchKeyword" VALUES
    ('k01', 'ผ้าเบรค (Brake Pad)', 'ผ้าเบรค', 'category', 'หมวดหมู่', 950, '${SEEDED_AT}', '${SEEDED_AT}'),
    ('k02', 'Vios', 'vios', 'carModel', 'Toyota', 700, '${SEEDED_AT}', '${SEEDED_AT}'),
    ('k03', 'Brake Pad X', 'brake pad x', 'product', 'สินค้า', 100, '${SEEDED_AT}', '${SEEDED_AT}'),
    ('k04', 'hot query', 'hot query', 'synonym', NULL, 250, '${SEEDED_AT}', '${SEEDED_AT}'),
    ('k05', 'Old Product', 'old product', 'product', 'สินค้า', 150, '${SEEDED_AT}', '${SEEDED_AT}'),
    ('k06', 'City', 'city', 'carModel', 'รุ่นรถ', 700, '${SEEDED_AT}', '${SEEDED_AT}'),
    ('k07', 'X', 'null to value', 'synonym', NULL, 300, '${SEEDED_AT}', '${SEEDED_AT}'),
    ('k08', 'Concurrent', 'concurrent', 'synonym', 'Concurrent', 300, '${FUTURE_AT}', '${FUTURE_AT}'),
    ('k09', 'Future', 'future unchanged', 'category', 'หมวดหมู่', 1000, '${FUTURE_AT}', '${FUTURE_AT}'),
    ('k10', 'Strada', 'starda', 'synonym', NULL, 300, '${SEEDED_AT}', '${SEEDED_AT}');
`;

/** Round 1: unchanged, changed (term / sublabel both ways / popularity), gone, new rows. */
const ROUND_1_ROWS: DraftRow[] = [
  { term: "ผ้าเบรค (Brake Pad)", normalized: "ผ้าเบรค", kind: "category", sublabel: "หมวดหมู่", popularity: 950 },
  { term: "Vios", normalized: "vios", kind: "carModel", sublabel: "Toyota", popularity: 700 },
  { term: "Brake Pad X", normalized: "brake pad x", kind: "product", sublabel: "สินค้า", popularity: 150 },
  { term: "hot query", normalized: "hot query", kind: "synonym", sublabel: null, popularity: 260 },
  { term: "City", normalized: "city", kind: "carModel", sublabel: null, popularity: 700 },
  { term: "X", normalized: "null to value", kind: "synonym", sublabel: "Y", popularity: 300 },
  { term: "Future", normalized: "future unchanged", kind: "category", sublabel: "หมวดหมู่", popularity: 1000 },
  { term: "Triton", normalized: "starda", kind: "synonym", sublabel: null, popularity: 300 },
  { term: "New Brand", normalized: "new brand", kind: "partsBrand", sublabel: "ยี่ห้ออะไหล่", popularity: 800 },
  { term: "Vios", normalized: "vios", kind: "synonym", sublabel: null, popularity: 300 },
];

/** Round 2: one popularity change, two rows gone (one of them future-dated), one new row. */
const ROUND_2_ROWS: DraftRow[] = [
  { term: "ผ้าเบรค (Brake Pad)", normalized: "ผ้าเบรค", kind: "category", sublabel: "หมวดหมู่", popularity: 1000 },
  { term: "Vios", normalized: "vios", kind: "carModel", sublabel: "Toyota", popularity: 700 },
  { term: "Brake Pad X", normalized: "brake pad x", kind: "product", sublabel: "สินค้า", popularity: 150 },
  { term: "hot query", normalized: "hot query", kind: "synonym", sublabel: null, popularity: 260 },
  { term: "City", normalized: "city", kind: "carModel", sublabel: null, popularity: 700 },
  { term: "X", normalized: "null to value", kind: "synonym", sublabel: "Y", popularity: 300 },
  { term: "Triton", normalized: "starda", kind: "synonym", sublabel: null, popularity: 300 },
  { term: "Vios", normalized: "vios", kind: "synonym", sublabel: null, popularity: 300 },
  { term: "D-Max", normalized: "d-max", kind: "carModel", sublabel: "Isuzu", popularity: 700 },
];

/** Same parameter handling as @prisma/adapter-pg: Dates go out as zone-less UTC strings. */
const toAdapterParam = (value: unknown): unknown =>
  value instanceof Date ? value.toISOString().replace("T", " ").replace("Z", "") : value;

const runOn = async (target: PGlite | Transaction, sql: Prisma.Sql): Promise<number> => {
  const result = await target.query(sql.text, sql.values.map(toAdapterParam));
  return result.affectedRows ?? 0;
};

// ── The previous rebuild SQL, kept verbatim as the reference ────────────────
const buildPreviousUpsertSql = (rows: DraftRow[], runStartedAt: Date): Prisma.Sql => Prisma.sql`
    INSERT INTO "SearchKeyword" ("id", "term", "normalized", "kind", "sublabel", "popularity", "createdAt", "updatedAt")
    VALUES ${Prisma.join(
      rows.map(
        (row) => Prisma.sql`(
          gen_random_uuid()::text,
          ${row.term},
          ${row.normalized},
          ${row.kind},
          ${row.sublabel},
          ${row.popularity},
          ${runStartedAt},
          ${runStartedAt}
        )`,
      ),
    )}
    ON CONFLICT ("normalized", "kind") DO UPDATE SET
      "term" = EXCLUDED."term",
      "sublabel" = EXCLUDED."sublabel",
      "popularity" = EXCLUDED."popularity",
      "updatedAt" = ${runStartedAt}
  `;

const runPreviousRebuild = async (pg: PGlite, rows: DraftRow[], runStartedAt: Date): Promise<void> => {
  await pg.transaction(async (tx) => {
    for (let index = 0; index < rows.length; index += BATCH_SIZE) {
      await runOn(tx, buildPreviousUpsertSql(rows.slice(index, index + BATCH_SIZE), runStartedAt));
    }
    await runOn(tx, Prisma.sql`DELETE FROM "SearchKeyword" WHERE "updatedAt" < ${runStartedAt}`);
  });
};

const writeCounts = { statements: 0, affectedRows: 0 };

const runCurrentRebuild = async (pg: PGlite, rows: DraftRow[], runStartedAt: Date): Promise<void> => {
  const { runSearchKeywordRefreshWithDeps } = await import("@/lib/search-keyword-index");
  const outcome = await runSearchKeywordRefreshWithDeps({
    buildRows: async () => rows,
    now: () => runStartedAt,
    batchSize: BATCH_SIZE,
    log: { info() {}, warn() {}, error() {} },
    runTx: (fn) =>
      pg.transaction((tx) =>
        fn({
          $queryRaw: async <T>(sql: Prisma.Sql): Promise<T> => {
            const result = await tx.query(sql.text, sql.values.map(toAdapterParam));
            return result.rows as T;
          },
          $executeRaw: async (sql: Prisma.Sql): Promise<number> => {
            const affected = await runOn(tx, sql);
            writeCounts.statements += 1;
            writeCounts.affectedRows += affected;
            return affected;
          },
        }),
      ),
  });
  assert.equal(outcome.skipped, null);
  // The outcome (and so the log line and the cron response) is unchanged.
  assert.equal(outcome.rowsWritten, rows.length);
  assert.equal(outcome.batches, Math.ceil(rows.length / BATCH_SIZE));
};

const readTable = async (pg: PGlite): Promise<TableRow[]> =>
  (
    await pg.query<TableRow>(
      `SELECT "id", "term", "normalized", "kind", "sublabel", "popularity", "createdAt", "updatedAt"
       FROM "SearchKeyword" ORDER BY "normalized", "kind"`,
    )
  ).rows;

const readPhysical = async (pg: PGlite): Promise<PhysicalRow[]> =>
  (
    await pg.query<PhysicalRow>(
      `SELECT "normalized", "kind", xmin::text AS xmin, ctid::text AS ctid
       FROM "SearchKeyword" ORDER BY "normalized", "kind"`,
    )
  ).rows;

/** Every column a reader uses, plus createdAt. Ids of seeded rows are compared separately. */
const appView = (rows: TableRow[]) =>
  rows.map((row) => ({
    normalized: row.normalized,
    kind: row.kind,
    term: row.term,
    sublabel: row.sublabel,
    popularity: row.popularity,
    createdAt: row.createdAt.toISOString(),
    seededId: row.id.startsWith("k") ? row.id : null,
  }));

let previous: PGlite;
let current: PGlite;

before(async () => {
  previous = new PGlite();
  current = new PGlite();
  await previous.exec(SCHEMA);
  await current.exec(SCHEMA);
});

after(async () => {
  await previous?.close();
  await current?.close();
});

test("round 1: same final table as the previous rebuild (changed, unchanged, gone, new and future-dated rows)", async () => {
  await runPreviousRebuild(previous, ROUND_1_ROWS, ROUND_1_AT);
  await runCurrentRebuild(current, ROUND_1_ROWS, ROUND_1_AT);

  const previousRows = await readTable(previous);
  const currentRows = await readTable(current);
  assert.deepEqual(appView(currentRows), appView(previousRows));

  const keys = currentRows.map((row) => `${row.normalized}|${row.kind}`);
  assert.ok(!keys.includes("old product|product"), "a row the run no longer produces is deleted");
  assert.ok(keys.includes("concurrent|synonym"), "a row written after the run started survives");
  assert.ok(keys.includes("new brand|partsBrand"));
  assert.equal(currentRows.find((row) => row.normalized === "starda")?.term, "Triton");
  assert.equal(currentRows.find((row) => row.normalized === "city")?.sublabel, null);
  assert.equal(currentRows.find((row) => row.normalized === "null to value")?.sublabel, "Y");
});

test("round 1: unchanged rows are not rewritten", async () => {
  const rows = await readTable(current);
  const updatedAtOf = (normalized: string, kind: string): string | undefined =>
    rows.find((row) => row.normalized === normalized && row.kind === kind)?.updatedAt.toISOString();

  assert.equal(updatedAtOf("ผ้าเบรค", "category"), SEEDED_AT);
  assert.equal(updatedAtOf("vios", "carModel"), SEEDED_AT);
  assert.equal(updatedAtOf("future unchanged", "category"), FUTURE_AT);
  assert.equal(updatedAtOf("brake pad x", "product"), ROUND_1_AT.toISOString());
  assert.equal(updatedAtOf("new brand", "partsBrand"), ROUND_1_AT.toISOString());
});

test("round 2: same final table as the previous rebuild after further changes", async () => {
  await runPreviousRebuild(previous, ROUND_2_ROWS, ROUND_2_AT);
  await runCurrentRebuild(current, ROUND_2_ROWS, ROUND_2_AT);

  const previousRows = await readTable(previous);
  const currentRows = await readTable(current);
  assert.deepEqual(appView(currentRows), appView(previousRows));

  const keys = currentRows.map((row) => `${row.normalized}|${row.kind}`);
  assert.ok(!keys.includes("future unchanged|category"), "a dropped row kept from round 1 is deleted");
  assert.ok(!keys.includes("concurrent|synonym"));
  assert.ok(!keys.includes("new brand|partsBrand"));
  assert.ok(keys.includes("d-max|carModel"));
});

test("round 3: a rebuild with nothing changed writes no row and still matches", async () => {
  const before = await readPhysical(current);
  writeCounts.statements = 0;
  writeCounts.affectedRows = 0;

  await runPreviousRebuild(previous, ROUND_2_ROWS, ROUND_3_AT);
  await runCurrentRebuild(current, ROUND_2_ROWS, ROUND_3_AT);

  assert.equal(writeCounts.affectedRows, 0, "no insert, update or delete");
  assert.deepEqual(await readPhysical(current), before, "every tuple is the same physical version");
  assert.deepEqual(appView(await readTable(current)), appView(await readTable(previous)));
});
