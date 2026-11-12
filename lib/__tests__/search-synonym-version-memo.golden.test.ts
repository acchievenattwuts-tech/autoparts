import assert from "node:assert/strict";
import test, { after, before, beforeEach, mock } from "node:test";
import { PGlite } from "@electric-sql/pglite";

import type { Prisma } from "@/lib/generated/prisma";

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

/**
 * Product search loads synonyms from inside its own unstable_cache, where Next
 * skips reading the nested synonym cache, so the loader runs on every search.
 * The loader now keeps the last read per instance and re-uses it while a 1-row
 * version check says the active rows are untouched.
 *
 * These tests run the real loader against an in-process Postgres (PGlite), with
 * unstable_cache replaced by a pass-through (exactly what the nested call does),
 * and compare every result with the direct findMany() read it replaces: same rows,
 * same order, after every kind of change — including ones made without the app.
 */

type SynonymRow = { term: string; synonyms: string[] };

let pg: PGlite;
const calls = { findMany: 0, fullReads: 0, versionChecks: 0 };

/** Prisma's findMany({ where: { isActive: true }, select: { term, synonyms } }) query. */
const directRows = async (): Promise<SynonymRow[]> =>
  (
    await pg.query<SynonymRow>(
      `SELECT "public"."SearchSynonym"."term", "public"."SearchSynonym"."synonyms"
       FROM "public"."SearchSynonym" WHERE "public"."SearchSynonym"."isActive" = $1 OFFSET $2`,
      [true, 0],
    )
  ).rows;

const db = {
  $queryRaw: async (sql: Prisma.Sql): Promise<unknown[]> => {
    if (sql.text.includes(`SELECT "term", "synonyms"`)) calls.fullReads += 1;
    else calls.versionChecks += 1;
    return (await pg.query(sql.text, sql.values)).rows;
  },
  searchSynonym: {
    findMany: async (): Promise<SynonymRow[]> => {
      calls.findMany += 1;
      return directRows();
    },
  },
};

const load = async (): Promise<SynonymRow[]> => {
  const { loadActiveSynonymRows } = await import("@/lib/search-synonyms");
  return loadActiveSynonymRows();
};

const resetCalls = (): void => {
  calls.findMany = 0;
  calls.fullReads = 0;
  calls.versionChecks = 0;
};

/** Loads through the memo and asserts the result equals the direct read, in order. */
const assertSameAsDirect = async (message: string): Promise<SynonymRow[]> => {
  const rows = await load();
  assert.deepEqual(rows, await directRows(), message);
  return rows;
};

before(async () => {
  if (moduleMocksUnavailable) return;
  pg = new PGlite();
  await pg.exec(`
    CREATE TABLE "SearchSynonym" (
      "id" TEXT PRIMARY KEY,
      "term" TEXT NOT NULL UNIQUE,
      "synonyms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      "language" TEXT,
      "isActive" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX "SearchSynonym_isActive_idx" ON "SearchSynonym" ("isActive");
    INSERT INTO "SearchSynonym" ("id", "term", "synonyms", "isActive") VALUES
      ('s1', 'คอมแอร์', ARRAY['compressor', 'คอมเพรสเซอร์'], true),
      ('s2', 'Vios', ARRAY['วีออส'], true),
      ('s3', 'หม้อน้ำ', ARRAY['radiator'], true),
      ('s4', 'ปิดใช้งาน', ARRAY['inactive'], false),
      ('s5', 'วาล์วแอร์', ARRAY['วาว์ล', 'expansion valve', 'บล็อควาล์ว'], true);
  `);
  await mock.module("@/lib/db", { namedExports: { db } });
  await mock.module("next/cache", {
    namedExports: {
      // The nested-cache behaviour: the callback runs on every call.
      unstable_cache: <A extends unknown[], R>(fn: (...args: A) => Promise<R>) => fn,
    },
  });
});

after(async () => {
  await pg?.close();
});

beforeEach(async () => {
  if (moduleMocksUnavailable) return;
  const { resetActiveSynonymSnapshotForTest } = await import("@/lib/search-synonyms");
  resetActiveSynonymSnapshotForTest();
  resetCalls();
});

test("first read loads the full table once; repeats only check the version", { skip: moduleMocksUnavailable }, async () => {
  await assertSameAsDirect("first read");
  assert.deepEqual(calls, { findMany: 0, fullReads: 1, versionChecks: 0 });

  for (let index = 0; index < 5; index += 1) await assertSameAsDirect(`repeat ${index}`);
  assert.deepEqual(calls, { findMany: 0, fullReads: 1, versionChecks: 5 });
});

test("a returned row set is a copy, so a caller cannot change the next result", { skip: moduleMocksUnavailable }, async () => {
  const first = await load();
  first[0].synonyms.push("mutated");
  first.pop();
  await assertSameAsDirect("after mutating a previous result");
});

test("every kind of change is seen on the very next read", { skip: moduleMocksUnavailable }, async () => {
  await assertSameAsDirect("warm");

  const changes: Array<[string, string]> = [
    ["synonym list edited", `UPDATE "SearchSynonym" SET "synonyms" = ARRAY['radiator', 'หม้อน้ำรถยนต์'] WHERE "id" = 's3'`],
    ["same-value save (moves the row to the end of the heap)", `UPDATE "SearchSynonym" SET "synonyms" = "synonyms" WHERE "id" = 's1'`],
    ["raw SQL edit that leaves updatedAt alone", `UPDATE "SearchSynonym" SET "term" = 'VIOS' WHERE "id" = 's2'`],
    ["new active row", `INSERT INTO "SearchSynonym" ("id", "term", "synonyms") VALUES ('s6', 'ผ้าเบรค', ARRAY['brake pad'])`],
    ["row deactivated", `UPDATE "SearchSynonym" SET "isActive" = false WHERE "id" = 's5'`],
    ["row re-activated", `UPDATE "SearchSynonym" SET "isActive" = true WHERE "id" = 's4'`],
    ["row deleted", `DELETE FROM "SearchSynonym" WHERE "id" = 's6'`],
    [
      "row deleted and re-inserted with identical content",
      `DELETE FROM "SearchSynonym" WHERE "id" = 's3';
       INSERT INTO "SearchSynonym" ("id", "term", "synonyms") VALUES ('s3', 'หม้อน้ำ', ARRAY['radiator', 'หม้อน้ำรถยนต์'])`,
    ],
  ];

  for (const [label, sql] of changes) {
    await pg.exec(sql);
    resetCalls();
    await assertSameAsDirect(label);
    // Even a change that leaves the content identical (same-value save, identical
    // re-insert) forces a re-read — the copy is never served across a write.
    assert.deepEqual(calls, { findMany: 0, fullReads: 1, versionChecks: 1 }, `${label}: re-read the table`);
  }
});

test("maintenance that does not touch the active rows keeps the cached copy", { skip: moduleMocksUnavailable }, async () => {
  await assertSameAsDirect("warm");
  await pg.exec(`VACUUM "SearchSynonym"`);
  await pg.exec(`UPDATE "SearchSynonym" SET "language" = 'th' WHERE "isActive" = false`);
  resetCalls();
  await assertSameAsDirect("after vacuum and an inactive-row edit");
  assert.deepEqual(calls, { findMany: 0, fullReads: 0, versionChecks: 1 });
});

test("an empty active set returns [] like the direct read", { skip: moduleMocksUnavailable }, async () => {
  await pg.exec(`UPDATE "SearchSynonym" SET "isActive" = false`);
  assert.deepEqual(await load(), []);
  assert.deepEqual(await load(), []);
  await pg.exec(`UPDATE "SearchSynonym" SET "isActive" = true WHERE "id" IN ('s1', 's2')`);
  await assertSameAsDirect("after re-activating");
});

test("bypassCache still reads the table directly", { skip: moduleMocksUnavailable }, async () => {
  const { loadActiveSynonymRows } = await import("@/lib/search-synonyms");
  assert.deepEqual(await loadActiveSynonymRows({ bypassCache: true }), await directRows());
  assert.deepEqual(calls, { findMany: 1, fullReads: 0, versionChecks: 0 });
});

test("query expansion is identical with the cached copy and with a direct read", { skip: moduleMocksUnavailable }, async () => {
  const { expandQueryTokenGroups, expandQueryTokens } = await import("@/lib/search-synonyms");
  const queries = ["vios หม้อน้ำ", "คอมแอร์ vios 2010", "compressor", "บล็อควาล์ว revo", "ไม่มีคำนี้"];
  await load();
  for (const query of queries) {
    const cached = await expandQueryTokenGroups(query);
    const direct = await expandQueryTokenGroups(query, { bypassCache: true });
    assert.deepEqual(cached, direct, query);
    assert.deepEqual(await expandQueryTokens(query), await expandQueryTokens(query), query);
  }
  assert.equal(calls.fullReads, 1, "every expansion after the first re-used the cached copy");
});
