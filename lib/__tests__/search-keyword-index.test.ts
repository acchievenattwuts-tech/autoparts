import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";

test("synonym aliases are indexed as lookup keys for their canonical term", async () => {
  const { buildSynonymKeywordDrafts } = await import("@/lib/search-keyword-index");

  const rows = buildSynonymKeywordDrafts([{ term: "D-Max", synonyms: ["ออนิว", "All New"] }]);

  assert.deepEqual(
    rows.map((row) => ({ term: row.term, normalized: row.normalized, kind: row.kind })),
    [
      { term: "D-Max", normalized: "d-max", kind: "synonym" },
      { term: "D-Max", normalized: "ออนิว", kind: "synonym" },
      { term: "D-Max", normalized: "all new", kind: "synonym" },
    ],
  );
});

test("refresh runner skips writes when another instance already holds the advisory lock", async () => {
  const mod = await import("@/lib/search-keyword-index");

  assert.equal(typeof mod.runSearchKeywordRefreshWithDeps, "function");

  const executeCalls: unknown[] = [];
  const outcome = await mod.runSearchKeywordRefreshWithDeps({
    buildRows: async () => [
      { term: "Brake Pad", normalized: "brake pad", kind: "product", sublabel: "สินค้า", popularity: 150 },
    ],
    now: () => new Date("2026-07-08T02:30:00.000Z"),
    batchSize: 2,
    log: { info() {}, warn() {}, error() {} },
    runTx: async (fn) =>
      fn({
        $queryRaw: async <T>() => [{ acquired: false }] as T,
        $executeRaw: async (...args: unknown[]) => {
          executeCalls.push(args);
          return 0;
        },
      }),
  });

  assert.deepEqual(outcome, {
    rowsBuilt: 1,
    rowsWritten: 0,
    batches: 0,
    skipped: "LOCKED",
  });
  assert.equal(executeCalls.length, 0);
});

test("refresh runner upserts rows in batches and deletes stale rows once", async () => {
  const mod = await import("@/lib/search-keyword-index");

  assert.equal(typeof mod.runSearchKeywordRefreshWithDeps, "function");

  const executeCalls: unknown[] = [];
  const outcome = await mod.runSearchKeywordRefreshWithDeps({
    buildRows: async () => [
      { term: "A", normalized: "a1", kind: "product", sublabel: "สินค้า", popularity: 1 },
      { term: "B", normalized: "b1", kind: "product", sublabel: "สินค้า", popularity: 2 },
      { term: "C", normalized: "c1", kind: "product", sublabel: "สินค้า", popularity: 3 },
    ],
    now: () => new Date("2026-07-08T02:30:00.000Z"),
    batchSize: 2,
    log: { info() {}, warn() {}, error() {} },
    runTx: async (fn) =>
      fn({
        $queryRaw: async <T>() => [{ acquired: true }] as T,
        $executeRaw: async (...args: unknown[]) => {
          executeCalls.push(args);
          return 0;
        },
      }),
  });

  assert.deepEqual(outcome, {
    rowsBuilt: 3,
    rowsWritten: 3,
    batches: 2,
    skipped: null,
  });
  assert.equal(executeCalls.length, 3);
});
