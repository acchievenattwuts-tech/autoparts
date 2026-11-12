import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { vector } from "@electric-sql/pglite/vector";

/**
 * D1 golden test (review 2026-11-12): the statement-level alias / fitment triggers and the
 * stock-only Product path must leave product_search_documents exactly as the old row-level
 * triggers (and the full refresh) leave it.
 *
 * Every database runs the REAL prisma/scripts/setup-search-v2.ts SQL (pg_trgm, unaccent and
 * pgvector are PGlite extensions, nothing is stubbed) on the same minimal app tables.
 *   - old: setup + triggers/rollback-search-document-triggers.sql (the pre-2026-11-12 row triggers)
 *   - new: old + triggers/01-search-document-triggers.sql, i.e. production after the migration
 * The same mixed sequence of statements runs on both. After every step, every column of every
 * document row is compared. updated_at is compared as "which step last wrote it" (each database
 * has its own clock, so the raw instants differ by construction); the value itself must equal that
 * step's transaction timestamp in both databases. The new database must also equal a fresh
 * build_product_search_text() for every product after every step.
 *
 * The only allowed difference is a row the OLD triggers left stale: moving an alias / fitment row
 * to another product refreshed only the new product. Those rows are listed exactly below.
 */

const ROOT = process.cwd();
const MIGRATION_DIR = "prisma/migrations/20261112_review_round3";
/**
 * Line endings are normalised to LF: a JS template literal turns CRLF into LF at runtime (so that
 * is what setup-search-v2.ts sends), and a .sql file's endings depend on the git checkout. Line
 * terminators inside a plpgsql body do not change what it does.
 */
const readRepoFile = (path: string): string => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");

const STEP_GAP_MS = 3;
const EMBEDDING_DIMENSIONS = 768;

const extractSetupSql = (): string => {
  const source = readRepoFile("prisma/scripts/setup-search-v2.ts");
  const match = source.match(/const setupSql = `([\s\S]*?)`;\r?\n/);
  assert.ok(match, "setupSql template literal not found in prisma/scripts/setup-search-v2.ts");
  assert.ok(!match[1].includes("${") && !match[1].includes("\\"), "setupSql must stay a plain literal");
  return match[1];
};

const SETUP_SQL = extractSetupSql();
const LEGACY_TRIGGERS_SQL = readRepoFile(`${MIGRATION_DIR}/triggers/rollback-search-document-triggers.sql`);
const NEW_TRIGGERS_SQL = readRepoFile(`${MIGRATION_DIR}/triggers/01-search-document-triggers.sql`);
const RESYNC_SQL = readRepoFile(`${MIGRATION_DIR}/triggers/02-resync-stale-search-documents.sql`);
const FILLFACTOR_SQL = readRepoFile(`${MIGRATION_DIR}/storage/01-search-documents-fillfactor.sql`);

/** The app tables build_product_search_text reads, with the production column names and FKs. */
const BASE_SCHEMA = `
  SET TIME ZONE 'UTC';
  CREATE TYPE "AliasKind" AS ENUM ('ALIAS', 'OEM', 'PART_NO', 'CROSS_REF', 'KEYWORD', 'MISSPELL', 'EN', 'TH');
  CREATE TYPE "ProductFitmentType" AS ENUM ('DIRECT', 'COMPATIBLE');
  CREATE TABLE "Category" ("id" TEXT PRIMARY KEY, "name" TEXT NOT NULL UNIQUE);
  CREATE TABLE "PartsBrand" ("id" TEXT PRIMARY KEY, "name" TEXT NOT NULL UNIQUE);
  CREATE TABLE "CarBrand" ("id" TEXT PRIMARY KEY, "name" TEXT NOT NULL UNIQUE);
  CREATE TABLE "CarModel" ("id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "carBrandId" TEXT NOT NULL REFERENCES "CarBrand"("id"));
  CREATE TABLE "Product" (
    "id" TEXT PRIMARY KEY,
    "code" TEXT NOT NULL UNIQUE,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "categoryId" TEXT NOT NULL REFERENCES "Category"("id"),
    "brandId" TEXT REFERENCES "PartsBrand"("id"),
    "salePrice" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "avgCost" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "minStock" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE "ProductAlias" (
    "id" TEXT PRIMARY KEY,
    "productId" TEXT NOT NULL REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "alias" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" "AliasKind" NOT NULL DEFAULT 'ALIAS',
    "weight" INTEGER,
    UNIQUE ("productId", "alias", "kind")
  );
  CREATE TABLE "ProductCarModel" (
    "productId" TEXT NOT NULL REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "carModelId" TEXT NOT NULL REFERENCES "CarModel"("id"),
    "id" TEXT PRIMARY KEY,
    "fitmentType" "ProductFitmentType" NOT NULL DEFAULT 'DIRECT',
    "submodel" TEXT,
    "yearStart" INTEGER,
    "yearEnd" INTEGER,
    "engineCode" TEXT,
    "engineSize" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE "SearchSynonym" ("id" TEXT PRIMARY KEY, "term" TEXT NOT NULL UNIQUE);
`;

const ALIAS_KINDS_SQL = `(ARRAY['ALIAS','OEM','PART_NO','CROSS_REF','KEYWORD','MISSPELL','EN','TH'])`;
const EMBEDDING_SQL = `('[' || array_to_string(array_fill(0.25::float4, ARRAY[${EMBEDDING_DIMENSIONS}]), ',') || ']')::vector`;

type Step = { name: string; sql: string };

const STEPS: readonly Step[] = [
  {
    name: "seed master data",
    sql: `
      INSERT INTO "Category" VALUES ('cat-brake', 'ผ้าเบรก'), ('cat-air', 'คอมแอร์');
      INSERT INTO "PartsBrand" VALUES ('br-a', 'Bendix'), ('br-b', 'Denso');
      INSERT INTO "CarBrand" VALUES ('cb-t', 'Toyota'), ('cb-h', 'Honda');
      INSERT INTO "CarModel" VALUES ('cm-vios', 'Vios', 'cb-t'), ('cm-yaris', 'Yaris', 'cb-t'), ('cm-city', 'City', 'cb-h');`,
  },
  {
    name: "create P1, then 38 aliases in one statement",
    sql: `
      INSERT INTO "Product" ("id", "code", "name", "description", "categoryId", "brandId", "stock", "createdAt")
        VALUES ('p1', 'BP-001', 'ผ้าเบรกหน้า Vios', 'ผ้าเบรกเซรามิก', 'cat-brake', 'br-a', 10, '2026-01-02T03:04:05.678Z');
      INSERT INTO "ProductAlias" ("id", "productId", "alias", "kind")
        SELECT 'a1-' || g, 'p1', 'คำค้น ' || g || ' Café', (${ALIAS_KINDS_SQL})[g % 8 + 1]::"AliasKind"
        FROM generate_series(1, 38) AS g;`,
  },
  {
    name: "create P2 with aliases row by row and two fitments in one statement",
    sql: `
      INSERT INTO "Product" ("id", "code", "name", "description", "categoryId", "brandId", "stock", "createdAt")
        VALUES ('p2', 'AC-100', 'คอมแอร์ Yaris', NULL, 'cat-air', 'br-b', 3, '2026-02-03T04:05:06.789Z');
      INSERT INTO "ProductAlias" ("id", "productId", "alias", "kind") VALUES ('a2-1', 'p2', 'compressor', 'EN');
      INSERT INTO "ProductAlias" ("id", "productId", "alias", "kind") VALUES ('a2-2', 'p2', '88320-0D010', 'OEM');
      INSERT INTO "ProductCarModel" ("productId", "carModelId", "id", "yearStart", "yearEnd", "engineCode")
        VALUES ('p2', 'cm-yaris', 'f2-1', 2014, 2017, '1NZ'), ('p2', 'cm-vios', 'f2-2', 2013, NULL, NULL);`,
  },
  {
    name: "create P3 and P4 (no brand, no description, no aliases)",
    sql: `
      INSERT INTO "Product" ("id", "code", "name", "categoryId", "brandId", "stock", "createdAt")
        VALUES ('p3', 'BP-002', 'ผ้าเบรกหลัง City', 'cat-brake', 'br-a', 0, '2026-03-04T05:06:07.890Z'),
               ('p4', 'MISC-1', 'น้ำยาแอร์', 'cat-air', NULL, 7, '2026-03-04T05:06:07.890Z');`,
  },
  { name: "edit one alias text", sql: `UPDATE "ProductAlias" SET "alias" = 'ผ้าเบรกหน้า วีออส' WHERE "id" = 'a1-3';` },
  {
    name: "weight-only update of many aliases (no document text changes)",
    sql: `UPDATE "ProductAlias" SET "weight" = 5 WHERE "productId" = 'p1' AND "kind" = 'OEM';`,
  },
  { name: "delete one alias", sql: `DELETE FROM "ProductAlias" WHERE "id" = 'a1-4';` },
  { name: "delete all KEYWORD aliases of P1", sql: `DELETE FROM "ProductAlias" WHERE "productId" = 'p1' AND "kind" = 'KEYWORD';` },
  { name: "move one alias to another product", sql: `UPDATE "ProductAlias" SET "productId" = 'p2' WHERE "id" = 'a1-5';` },
  {
    name: "move aliases of two products to a third in one statement",
    sql: `UPDATE "ProductAlias" SET "productId" = 'p3' WHERE "id" IN ('a1-6', 'a2-1');`,
  },
  {
    name: "insert two fitments for P1 in one statement",
    sql: `
      INSERT INTO "ProductCarModel" ("productId", "carModelId", "id", "submodel", "yearStart", "engineSize", "note")
        VALUES ('p1', 'cm-vios', 'f1-1', 'J', 2013, '1.5', 'ยกเว้นรุ่น TRD'), ('p1', 'cm-city', 'f1-2', NULL, NULL, NULL, NULL);`,
  },
  { name: "edit a fitment year range", sql: `UPDATE "ProductCarModel" SET "yearEnd" = 2020 WHERE "id" = 'f1-1';` },
  { name: "move a fitment to another product", sql: `UPDATE "ProductCarModel" SET "productId" = 'p3' WHERE "id" = 'f2-1';` },
  { name: "delete a fitment", sql: `DELETE FROM "ProductCarModel" WHERE "id" = 'f1-2';` },
  {
    name: "stock-only update of P1 (one sale line through writeStockCard)",
    sql: `UPDATE "Product" SET "stock" = "stock" - 2, "avgCost" = 120.50, "updatedAt" = now() WHERE "id" = 'p1';`,
  },
  {
    name: "stock-only update of several products in one statement",
    sql: `UPDATE "Product" SET "stock" = "stock" + 5, "updatedAt" = now() WHERE "id" IN ('p1', 'p2', 'p3');`,
  },
  {
    name: "update of columns the document does not read",
    sql: `UPDATE "Product" SET "minStock" = 3, "salePrice" = 990, "updatedAt" = now() WHERE "id" = 'p2';`,
  },
  { name: "no-op update", sql: `UPDATE "Product" SET "stock" = "stock" WHERE "id" = 'p4';` },
  {
    name: "name and price update",
    sql: `UPDATE "Product" SET "name" = 'ผ้าเบรกหน้า Vios 2013', "salePrice" = 1200, "updatedAt" = now() WHERE "id" = 'p1';`,
  },
  {
    name: "stock and name change in one statement",
    sql: `UPDATE "Product" SET "stock" = "stock" - 1, "name" = "name" || ' (ใหม่)' WHERE "id" = 'p2';`,
  },
  {
    name: "description set from NULL, then cleared again, in one transaction",
    sql: `
      UPDATE "Product" SET "description" = 'สำหรับรถเก๋ง' WHERE "id" = 'p4';
      UPDATE "Product" SET "description" = NULL WHERE "id" = 'p4';`,
  },
  {
    name: "category and brand change",
    sql: `UPDATE "Product" SET "categoryId" = 'cat-air', "brandId" = NULL WHERE "id" = 'p3';`,
  },
  { name: "deactivate a product", sql: `UPDATE "Product" SET "isActive" = false WHERE "id" = 'p2';` },
  { name: "rename a category", sql: `UPDATE "Category" SET "name" = 'ผ้าดิสก์เบรก' WHERE "id" = 'cat-brake';` },
  { name: "rename a car model", sql: `UPDATE "CarModel" SET "name" = 'Vios Gen3' WHERE "id" = 'cm-vios';` },
  {
    name: "alias upsert that inserts one row and updates another",
    sql: `
      INSERT INTO "ProductAlias" ("id", "productId", "alias", "kind")
        VALUES ('a1-1', 'p1', 'ignored', 'ALIAS'), ('a4-1', 'p4', 'R134a', 'OEM')
        ON CONFLICT ("id") DO UPDATE SET "alias" = 'คำค้นใหม่';`,
  },
  {
    name: "popularity cron and embedding sync write their own columns",
    sql: `
      UPDATE product_search_documents
        SET sales_count = 7, embedding = ${EMBEDDING_SQL}, embedding_model = 'test-model',
            embedding_source_hash = 'hash-1', embedded_at = '2026-11-01T00:00:00.000Z', updated_at = now()
        WHERE product_id = 'p1';`,
  },
  {
    name: "stock-only update after the cron keeps sales_count and the embedding",
    sql: `UPDATE "Product" SET "stock" = "stock" - 1 WHERE "id" = 'p1';`,
  },
  {
    name: "stock-only update of a product whose document row is missing",
    sql: `
      DELETE FROM product_search_documents WHERE product_id = 'p3';
      UPDATE "Product" SET "stock" = "stock" + 1 WHERE "id" = 'p3';`,
  },
  {
    name: "alias edit, stock change and alias insert in one transaction",
    sql: `
      UPDATE "ProductAlias" SET "alias" = 'abc' WHERE "id" = 'a1-7';
      UPDATE "Product" SET "stock" = 0 WHERE "id" = 'p1';
      INSERT INTO "ProductAlias" ("id", "productId", "alias", "kind") VALUES ('a1-99', 'p1', 'vios brake', 'MISSPELL');`,
  },
  { name: "delete a product with aliases and fitments (cascade)", sql: `DELETE FROM "Product" WHERE "id" = 'p3';` },
];

/** Rows the OLD row-level triggers leave stale after each step (an alias / fitment moved away from them). */
const LEGACY_STALE_BY_STEP: Readonly<Record<string, readonly string[]>> = {
  "move one alias to another product": ["p1"],
  "move aliases of two products to a third in one statement": ["p1", "p2"],
  "insert two fitments for P1 in one statement": ["p2"],
  "edit a fitment year range": ["p2"],
  "move a fitment to another product": ["p2"],
  "delete a fitment": ["p2"],
  "stock-only update of P1 (one sale line through writeStockCard)": ["p2"],
};

type DocumentRow = { product_id: string; doc: Record<string, unknown>; updated_at: string };
type WriteCounts = { ins: number; upd: number; hot: number; del: number };
type StepResult = { timestamp: string; writes: WriteCounts };
type Truth = { stale: string[]; missing: string[]; orphan: string[] };

const createDatabase = async (): Promise<PGlite> => {
  const db = new PGlite({ extensions: { pg_trgm, unaccent, vector } });
  await db.exec(BASE_SCHEMA);
  await db.exec(SETUP_SQL);
  return db;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const readWriteCounts = async (tx: Transaction): Promise<WriteCounts> => {
  const { rows } = await tx.query<WriteCounts>(
    `SELECT n_tup_ins::int AS ins, n_tup_upd::int AS upd, n_tup_hot_upd::int AS hot, n_tup_del::int AS del
     FROM pg_stat_xact_user_tables WHERE relname = 'product_search_documents'`,
  );
  return rows[0] ?? { ins: 0, upd: 0, hot: 0, del: 0 };
};

const runStep = async (db: PGlite, step: Step): Promise<StepResult> => {
  const result = await db.transaction(async (tx) => {
    const before = await readWriteCounts(tx);
    await tx.exec(step.sql);
    const after = await readWriteCounts(tx);
    const { rows } = await tx.query<{ ts: string }>(`SELECT now()::text AS ts`);
    return {
      timestamp: rows[0].ts,
      writes: {
        ins: after.ins - before.ins,
        upd: after.upd - before.upd,
        hot: after.hot - before.hot,
        del: after.del - before.del,
      },
    };
  });
  await sleep(STEP_GAP_MS);
  return result;
};

const readDocuments = async (db: PGlite): Promise<Map<string, DocumentRow>> => {
  const { rows } = await db.query<DocumentRow>(
    `SELECT d.product_id, to_jsonb(d) - 'updated_at' AS doc, d.updated_at::text AS updated_at
     FROM product_search_documents d ORDER BY d.product_id`,
  );
  return new Map(rows.map((row) => [row.product_id, row]));
};

/** Documents compared with a fresh build_product_search_text() (every column the refresh writes). */
const readTruth = async (db: PGlite): Promise<Truth> => {
  const { rows } = await db.query<{ product_id: string; doc: Record<string, unknown>; built: Record<string, unknown> | null }>(
    `SELECT d.product_id, to_jsonb(d) AS doc, CASE WHEN b.product_code IS NULL THEN NULL ELSE to_jsonb(b) END AS built
     FROM product_search_documents d
     LEFT JOIN LATERAL build_product_search_text(d.product_id) b ON TRUE
     ORDER BY d.product_id`,
  );
  const missing = await db.query<{ id: string }>(
    `SELECT p.id FROM "Product" p WHERE NOT EXISTS (SELECT 1 FROM product_search_documents d WHERE d.product_id = p.id) ORDER BY p.id`,
  );
  const stale = rows
    .filter((row) => row.built !== null)
    .filter((row) => Object.entries(row.built ?? {}).some(([key, value]) => JSON.stringify(row.doc[key]) !== JSON.stringify(value)))
    .map((row) => row.product_id);
  return {
    stale,
    missing: missing.rows.map((row) => row.id),
    orphan: rows.filter((row) => row.built === null).map((row) => row.product_id),
  };
};

const stepOf = (stamps: ReadonlyMap<string, string>, timestamp: string): string => stamps.get(timestamp) ?? `unknown ${timestamp}`;

type Definitions = { triggers: unknown[]; functions: unknown[]; reloptions: unknown };

const readDefinitions = async (db: PGlite): Promise<Definitions> => {
  const triggers = await db.query(
    `SELECT c.relname, t.tgname, pg_get_triggerdef(t.oid) AS def
     FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE NOT t.tgisinternal ORDER BY c.relname, t.tgname`,
  );
  const functions = await db.query(
    `SELECT p.proname, pg_get_functiondef(p.oid) AS def
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND (p.proname LIKE 'trg\\_refresh\\_product\\_search%' OR p.proname LIKE 'refresh\\_product\\_search%'
            OR p.proname = 'build_product_search_text')
     ORDER BY p.proname`,
  );
  const options = await db.query<{ reloptions: unknown }>(
    `SELECT reloptions FROM pg_class WHERE relname = 'product_search_documents'`,
  );
  return { triggers: triggers.rows, functions: functions.rows, reloptions: options.rows[0]?.reloptions };
};

test("D1: new triggers leave every document column identical to the old triggers and to a full refresh", async (t) => {
  const oldDb = await createDatabase();
  const newDb = await createDatabase();
  try {
    await oldDb.exec(LEGACY_TRIGGERS_SQL);
    await newDb.exec(LEGACY_TRIGGERS_SQL);
    await newDb.exec(NEW_TRIGGERS_SQL);

    const oldStamps = new Map<string, string>();
    const newStamps = new Map<string, string>();
    const observedLegacyStale: Record<string, string[]> = {};
    let oldWrites = 0;
    let newWrites = 0;

    for (const step of STEPS) {
      const oldResult = await runStep(oldDb, step);
      const newResult = await runStep(newDb, step);
      assert.ok(!oldStamps.has(oldResult.timestamp) && !newStamps.has(newResult.timestamp), `${step.name}: clock did not advance`);
      oldStamps.set(oldResult.timestamp, step.name);
      newStamps.set(newResult.timestamp, step.name);
      const sumWrites = (writes: WriteCounts): number => writes.ins + writes.upd + writes.del;
      oldWrites += sumWrites(oldResult.writes);
      newWrites += sumWrites(newResult.writes);
      t.diagnostic(`${step.name}: document writes old=${sumWrites(oldResult.writes)} new=${sumWrites(newResult.writes)} (new HOT ${newResult.writes.hot})`);

      const newTruth = await readTruth(newDb);
      assert.deepEqual(newTruth, { stale: [], missing: [], orphan: [] }, `${step.name}: new documents equal a full refresh`);
      const oldTruth = await readTruth(oldDb);
      assert.deepEqual([oldTruth.missing, oldTruth.orphan], [[], []], `${step.name}: old has no missing/orphan rows`);
      if (oldTruth.stale.length > 0) observedLegacyStale[step.name] = oldTruth.stale;

      const oldDocs = await readDocuments(oldDb);
      const newDocs = await readDocuments(newDb);
      assert.deepEqual([...newDocs.keys()], [...oldDocs.keys()], `${step.name}: same document rows`);
      for (const [productId, oldRow] of oldDocs) {
        if (oldTruth.stale.includes(productId)) continue;
        const newRow = newDocs.get(productId);
        assert.ok(newRow, `${step.name}: ${productId} present`);
        assert.deepEqual(newRow.doc, oldRow.doc, `${step.name}: ${productId} every column except updated_at`);
        assert.equal(
          stepOf(newStamps, newRow.updated_at),
          stepOf(oldStamps, oldRow.updated_at),
          `${step.name}: ${productId} updated_at written by the same step`,
        );
      }
    }

    assert.deepEqual(observedLegacyStale, LEGACY_STALE_BY_STEP, "the only differences are rows the old triggers left stale");
    assert.ok(newWrites < oldWrites, `fewer document writes overall (old ${oldWrites}, new ${newWrites})`);
  } finally {
    await oldDb.close();
    await newDb.close();
  }
});

test("D1: a product saved with 38 aliases refreshes its document once, and a stock change writes one row", async () => {
  const oldDb = await createDatabase();
  const newDb = await createDatabase();
  try {
    await oldDb.exec(LEGACY_TRIGGERS_SQL);
    await newDb.exec(LEGACY_TRIGGERS_SQL);
    await newDb.exec(NEW_TRIGGERS_SQL);
    const [seed, createP1] = STEPS;
    const stockStep: Step = { name: "stock", sql: `UPDATE "Product" SET "stock" = "stock" - 1 WHERE "id" = 'p1';` };
    await runStep(oldDb, seed);
    await runStep(newDb, seed);

    const oldCreate = await runStep(oldDb, createP1);
    const newCreate = await runStep(newDb, createP1);
    assert.deepEqual(oldCreate.writes, { ins: 1, upd: 38, hot: oldCreate.writes.hot, del: 0 }, "old: insert + 38 rebuilds");
    assert.deepEqual(newCreate.writes, { ins: 1, upd: 1, hot: newCreate.writes.hot, del: 0 }, "new: insert + 1 rebuild");

    const oldStock = await runStep(oldDb, stockStep);
    const newStock = await runStep(newDb, stockStep);
    assert.equal(oldStock.writes.upd, 1);
    assert.equal(newStock.writes.upd, 1);
    const docs = await readDocuments(newDb);
    assert.equal(docs.get("p1")?.doc.stock, 9);
  } finally {
    await oldDb.close();
    await newDb.close();
  }
});

test("D1: setup-search-v2.ts installs exactly the triggers and functions the migration installs", async () => {
  const fromSetup = await createDatabase();
  const fromMigration = await createDatabase();
  try {
    await fromMigration.exec(LEGACY_TRIGGERS_SQL);
    await fromMigration.exec(`ALTER TABLE product_search_documents RESET (fillfactor);`);
    await fromMigration.exec(NEW_TRIGGERS_SQL);
    await fromMigration.exec(FILLFACTOR_SQL);
    const setupDefinitions = await readDefinitions(fromSetup);
    assert.deepEqual(await readDefinitions(fromMigration), setupDefinitions);
    assert.deepEqual(setupDefinitions.reloptions, ["fillfactor=70"]);

    // Running the migration file a second time changes nothing (idempotent).
    await fromMigration.exec(NEW_TRIGGERS_SQL);
    assert.deepEqual(await readDefinitions(fromMigration), setupDefinitions);
  } finally {
    await fromSetup.close();
    await fromMigration.close();
  }
});

test("D1: the stock-only branch compares every Product column build_product_search_text reads", () => {
  const buildStart = SETUP_SQL.indexOf("CREATE OR REPLACE FUNCTION build_product_search_text");
  const buildBody = SETUP_SQL.slice(buildStart, SETUP_SQL.indexOf("\n$$;", buildStart));
  const readByBuild = new Set([...buildBody.matchAll(/\bp\.("?)([A-Za-z]+)\1/g)].map((match) => match[2]));
  const triggerStart = NEW_TRIGGERS_SQL.indexOf("CREATE OR REPLACE FUNCTION trg_refresh_product_search_document");
  const triggerBody = NEW_TRIGGERS_SQL.slice(triggerStart, NEW_TRIGGERS_SQL.indexOf("\n$$;", triggerStart));
  const compared = new Set([...triggerBody.matchAll(/NEW\.("?)([A-Za-z]+)\1 IS NOT DISTINCT FROM OLD\.\1\2\1/g)].map((match) => match[2]));

  assert.deepEqual([...readByBuild].sort(), ["brandId", "categoryId", "code", "createdAt", "description", "id", "isActive", "name", "stock"]);
  assert.deepEqual([...compared].sort(), [...readByBuild].filter((column) => column !== "stock").sort());
  assert.match(triggerBody, /SET stock = NEW\.stock,\s+updated_at = now\(\)/);
});

test("D1: the resync file heals documents the old triggers left stale and does not touch documents in sync", async () => {
  const db = await createDatabase();
  try {
    await db.exec(LEGACY_TRIGGERS_SQL);
    for (const step of STEPS.slice(0, 4)) await runStep(db, step);
    await runStep(db, { name: "legacy move", sql: `UPDATE "ProductAlias" SET "productId" = 'p2' WHERE "id" = 'a1-5';` });
    assert.deepEqual((await readTruth(db)).stale, ["p1"], "precondition: the legacy move left P1 stale");

    const before = await db.query<{ product_id: string; xmin: string }>(
      `SELECT product_id, xmin::text FROM product_search_documents ORDER BY product_id`,
    );
    await db.exec(NEW_TRIGGERS_SQL);
    await db.exec(RESYNC_SQL);
    const after = await db.query<{ product_id: string; xmin: string }>(
      `SELECT product_id, xmin::text FROM product_search_documents ORDER BY product_id`,
    );

    assert.deepEqual(await readTruth(db), { stale: [], missing: [], orphan: [] });
    const rewritten = after.rows.filter((row, index) => row.xmin !== before.rows[index]?.xmin).map((row) => row.product_id);
    assert.deepEqual(rewritten, ["p1"], "only the stale document is written");

    const xminBefore = after.rows.map((row) => row.xmin);
    await db.exec(RESYNC_SQL);
    const again = await db.query<{ xmin: string }>(`SELECT xmin::text FROM product_search_documents ORDER BY product_id`);
    assert.deepEqual(again.rows.map((row) => row.xmin), xminBefore, "a second run writes nothing");
  } finally {
    await db.close();
  }
});
