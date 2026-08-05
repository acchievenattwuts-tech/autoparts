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

test("coalescer keeps the follow-up rebuild inside the promise the caller awaits", async () => {
  const { createSearchKeywordRefreshCoalescer } = await import("@/lib/search-keyword-index");

  // A rerun started as a detached promise would be invisible to after()/waitUntil,
  // letting Vercel freeze the instance mid-rebuild — the connection-error bug.
  let runs = 0;
  let releaseFirstRun: (() => void) | undefined;
  const coalescer = createSearchKeywordRefreshCoalescer(async () => {
    runs += 1;
    if (runs === 1) await new Promise<void>((resolve) => (releaseFirstRun = resolve));
  });

  assert.equal(coalescer.isRunning(), false);
  const chain = coalescer.run();
  assert.equal(coalescer.isRunning(), true);

  // Two more triggers land while the first rebuild is still in flight.
  coalescer.markRerunPending();
  coalescer.markRerunPending();
  releaseFirstRun?.();

  await chain;

  assert.equal(runs, 2, "the pending rerun must finish before the awaited promise resolves");
  assert.equal(coalescer.isRunning(), false);
});

test("coalescer swallows a failed rebuild and still runs the pending rerun", async () => {
  const { createSearchKeywordRefreshCoalescer } = await import("@/lib/search-keyword-index");

  const errors: unknown[] = [];
  let runs = 0;
  const coalescer = createSearchKeywordRefreshCoalescer(
    async () => {
      runs += 1;
      if (runs === 1) {
        coalescer.markRerunPending();
        throw new Error("Client has encountered a connection error and is not queryable");
      }
    },
    { error: (...args: unknown[]) => errors.push(args) },
  );

  await coalescer.run();

  assert.equal(runs, 2);
  assert.equal(errors.length, 1);
});

test("refresh retries once on a transient connection error, but not on a real SQL error", async () => {
  const { runSearchKeywordRefreshWithRetry } = await import("@/lib/search-keyword-index");

  let attempts = 0;
  const rows = await runSearchKeywordRefreshWithRetry(
    async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("Client has encountered a connection error and is not queryable");
      }
      return 42;
    },
    { sleep: async () => {}, log: { warn() {} } },
  );

  assert.equal(rows, 42);
  assert.equal(attempts, 2);

  let sqlAttempts = 0;
  await assert.rejects(
    () =>
      runSearchKeywordRefreshWithRetry(
        async () => {
          sqlAttempts += 1;
          throw new Error('relation "SearchKeyword" does not exist');
        },
        { sleep: async () => {}, log: { warn() {} } },
      ),
    /does not exist/,
  );
  assert.equal(sqlAttempts, 1, "a non-transient failure must not be replayed");
});
