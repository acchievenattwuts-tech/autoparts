import assert from "node:assert/strict";
import test, { before, mock } from "node:test";

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

// generateAdjNo / generateBFNo gained an optional `tx`: when given, they take a
// per-month advisory lock and read through the transaction. The number itself
// must be exactly what the tx-less call returns for the same data.

let lastByPattern: Record<string, string> = {};
const log: string[] = [];

function makeClient(label: string) {
  const findFirst = (column: string) => async (args: { where: Record<string, { startsWith: string }> }) => {
    const pattern = args.where[column].startsWith;
    log.push(`${label}:findFirst:${pattern}`);
    const last = lastByPattern[pattern];
    return last ? { [column]: last } : null;
  };
  return {
    $executeRaw: async (query: { values?: unknown[] }) => {
      log.push(`${label}:lock:${String(query.values?.[0])}`);
      return 0;
    },
    adjustment: { findFirst: findFirst("adjustNo") },
    balanceForward: { findFirst: findFirst("docNo") },
  };
}

const db = makeClient("db");
const tx = makeClient("tx");

before(async () => {
  if (moduleMocksUnavailable) return;
  await mock.module("@/lib/db", { namedExports: { db } });
});

const cases: { date: Date; last: string | null }[] = [
  { date: new Date("2026-09-23T05:00:00Z"), last: null },
  { date: new Date("2026-09-23T05:00:00Z"), last: "0041" },
  { date: new Date("2026-09-23T05:00:00Z"), last: "9998" },
  // 18:30Z on 30 Sep is already 1 Oct in Thailand → next month's sequence.
  { date: new Date("2026-09-30T18:30:00Z"), last: "0007" },
];

test("generateAdjNo / generateBFNo with tx return the same number as without, after locking the month", { skip: moduleMocksUnavailable }, async () => {
  const { generateAdjNo, generateBFNo } = await import("@/lib/doc-number");
  const txClient = tx as unknown as Parameters<typeof generateAdjNo>[1];
  const generators = [
    { prefix: "ADJ", run: generateAdjNo },
    { prefix: "BF", run: generateBFNo },
  ];

  for (const { prefix, run } of generators) {
    for (const { date, last } of cases) {
      const month = date.getTime() === new Date("2026-09-30T18:30:00Z").getTime() ? "2610" : "2609";
      const pattern = `${prefix}${month}`;
      lastByPattern = last ? { [pattern]: `${pattern}${last}` } : {};

      log.length = 0;
      const withoutTx = await run(date);
      assert.deepEqual(log, [`db:findFirst:${pattern}`], "no lock and global client without tx");

      log.length = 0;
      const withTx = await run(date, txClient);
      assert.deepEqual(log, [`tx:lock:${pattern}`, `tx:findFirst:${pattern}`], "lock first, then read via tx");

      assert.equal(withTx, withoutTx);
      const expectedSeq = last ? String(Number(last) + 1).padStart(4, "0") : "0001";
      assert.equal(withTx, `${pattern}${expectedSeq}`);
    }
  }
});
