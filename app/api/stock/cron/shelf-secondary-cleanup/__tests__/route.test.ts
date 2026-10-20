import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

type FindManyArgs = { where: Record<string, unknown> };

const CREATED_AT = new Date("2026-09-01T03:00:00.000Z");

// p1: home A-2 plus two overflow locations; p2: overflow only (legacy data, no home).
const SECONDARY_ROWS = [
  { id: "s1", productId: "p1", level: 1, product: { code: "P0001" }, rack: { code: "Z" } },
  { id: "s2", productId: "p1", level: 2, product: { code: "P0001" }, rack: { code: "Z" } },
  { id: "s3", productId: "p2", level: 3, product: { code: "P0002" }, rack: { code: "B" } },
];
const REMAINING_ROWS = [
  {
    id: "h1",
    productId: "p1",
    level: 2,
    isPrimary: true,
    note: null,
    verifiedAt: null,
    createdAt: CREATED_AT,
    rack: { code: "A", name: null },
  },
];

let findManyCalls: FindManyArgs[] = [];
let deleteManyCalls: unknown[] = [];
let auditBatches: Array<{ data: Array<Record<string, unknown>> }> = [];
let secondaryRows = SECONDARY_ROWS;
let txError: Error | null = null;
let reportedScopes: string[] = [];
let GET: typeof import("../route").GET;

const fakeTx = {
  productShelfLocation: {
    findMany: async (args: FindManyArgs): Promise<unknown[]> => {
      findManyCalls.push(args);
      return args.where.isPrimary === false ? secondaryRows : REMAINING_ROWS;
    },
    deleteMany: async (args: unknown): Promise<{ count: number }> => {
      deleteManyCalls.push(args);
      return { count: secondaryRows.length };
    },
  },
  auditLog: {
    createMany: async (args: { data: Array<Record<string, unknown>> }): Promise<{ count: number }> => {
      auditBatches.push(args);
      return { count: args.data.length };
    },
  },
};

before(async () => {
  mock.module("@/lib/db", {
    namedExports: {
      db: {},
      dbTx: async <T>(fn: (tx: typeof fakeTx) => Promise<T>): Promise<T> => {
        if (txError) throw txError;
        return fn(fakeTx);
      },
    },
  });
  mock.module("@/lib/error-reporting", {
    namedExports: {
      reportCriticalError: async (_error: unknown, context: { scope: string }) => {
        reportedScopes.push(context.scope);
      },
    },
  });
  GET = (await import("../route")).GET;
});

beforeEach(() => {
  findManyCalls = [];
  deleteManyCalls = [];
  auditBatches = [];
  secondaryRows = SECONDARY_ROWS;
  txError = null;
  reportedScopes = [];
  process.env.CRON_SECRET = "test-cron-secret";
});

const authorized = (): Request =>
  new Request("https://shop.test/api/stock/cron/shelf-secondary-cleanup", {
    headers: { authorization: "Bearer test-cron-secret" },
  });

const quietly = async <T>(fn: () => Promise<T>): Promise<T> => {
  const logMock = mock.method(console, "log", () => undefined);
  try {
    return await fn();
  } finally {
    logMock.mock.restore();
  }
};

test("refuses a missing or wrong cron secret before touching any location", async () => {
  for (const authorization of [null, "Bearer wrong", "Basic test-cron-secret"]) {
    const headers = authorization ? { authorization } : undefined;
    const response = await GET(new Request("https://shop.test/api/stock/cron/shelf-secondary-cleanup", { headers }));
    assert.equal(response.status, 401);
  }
  assert.equal(findManyCalls.length + deleteManyCalls.length, 0);
});

test("removes only overflow locations of out-of-stock tracked products and audits each product once", async () => {
  const response = await quietly(() => GET(authorized()));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, products: 2, removed: 3 });

  const [cleanupQuery, remainingQuery] = findManyCalls;
  assert.deepEqual(cleanupQuery.where, {
    isPrimary: false,
    product: { isActive: true, inventoryTracking: "TRACKED", stock: { lte: 0 } },
  });
  assert.deepEqual(remainingQuery.where, { productId: { in: ["p1", "p2"] } });
  assert.deepEqual(deleteManyCalls, [{ where: { id: { in: ["s1", "s2", "s3"] }, isPrimary: false } }]);

  assert.equal(auditBatches.length, 1, "one INSERT for the whole run");
  const entries = auditBatches[0].data.map((entry) => ({
    userId: entry.userId,
    userName: entry.userName,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    entityRef: entry.entityRef,
    before: entry.before,
    after: entry.after,
    meta: entry.meta,
  }));
  assert.deepEqual(entries, [
    {
      userId: null,
      userName: null,
      action: "UPDATE",
      entityType: "Product",
      entityId: "p1",
      entityRef: "P0001",
      before: { shelfLocations: ["A-2 (ประจำ)", "Z-1 (เพิ่ม)", "Z-2 (เพิ่ม)"] },
      after: { shelfLocations: ["A-2 (ประจำ)"] },
      meta: {
        kind: "shelf_location",
        source: "shelf_secondary_cleanup",
        confirmOnly: false,
        trigger: "cron",
        removed: ["Z-1", "Z-2"],
      },
    },
    {
      userId: null,
      userName: null,
      action: "UPDATE",
      entityType: "Product",
      entityId: "p2",
      entityRef: "P0002",
      before: { shelfLocations: ["B-3 (เพิ่ม)"] },
      after: { shelfLocations: [] },
      meta: {
        kind: "shelf_location",
        source: "shelf_secondary_cleanup",
        confirmOnly: false,
        trigger: "cron",
        removed: ["B-3"],
      },
    },
  ]);
});

test("a quiet night writes nothing", async () => {
  secondaryRows = [];
  const response = await quietly(() => GET(authorized()));
  assert.deepEqual(await response.json(), { ok: true, products: 0, removed: 0 });
  assert.equal(findManyCalls.length, 1);
  assert.equal(deleteManyCalls.length + auditBatches.length, 0);
});

test("a failed run is reported under its own scope", async () => {
  txError = new Error("database unavailable");
  const response = await quietly(() => GET(authorized()));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { ok: false, error: "SHELF_CLEANUP_FAILED" });
  assert.deepEqual(reportedScopes, ["cron.shelf_secondary_cleanup"]);
});
