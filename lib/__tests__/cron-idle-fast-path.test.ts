import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test, { after, afterEach, before, mock } from "node:test";
import { PGlite } from "@electric-sql/pglite";

/**
 * F2 (2026-11-12): the every-minute storefront-sync and LINE AI crons now run one
 * EXISTS check first and return the zero result when it is false. These tests run
 * the old path (the check forced to fail, which falls through to the unchanged
 * statements) and the new check against the same rows in PGlite, at the same
 * frozen clock, and require:
 *   - the check is true exactly when one of the old statements would find a row,
 *   - an idle tick returns byte-identical JSON with a single statement,
 *   - a busy tick runs exactly the old statements, in the old order.
 */

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

const T0 = Date.now();
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

let pg: PGlite;
let forceFastPathError = false;
const statements: string[] = [];
const rowsReturned: Record<string, number> = {};

/** Same parameter handling as @prisma/adapter-pg: Dates go out as zone-less UTC strings. */
function toAdapterParam(value: unknown): unknown {
  if (!(value instanceof Date)) return value;
  return value.toISOString().replace("T", " ").replace("Z", "");
}

function labelRawStatement(text: string): string {
  if (text.includes('AS "hasWork"')) return "fastPathCheck";
  if (text.includes("STALE_PROCESSING_TIMEOUT")) return "lineStaleProcessingUpdate";
  if (text.includes("FOR UPDATE SKIP LOCKED")) return "lineClaimUpdate";
  if (text.includes('FROM "LineConversation"')) return "lineRecoveryScan";
  return "raw";
}

type SyncStateWhere = {
  status?: string | { in: string[] };
  nextAttemptAt?: { lte: Date };
  telegramNotifiedAt?: null;
};

/** Strict Prisma-semantics emulation of the where shapes processStorefrontSyncQueue reads with. */
function syncStateWhereToSql(where: SyncStateWhere): { clause: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  for (const [key, value] of Object.entries(where)) {
    if (key === "status" && typeof value === "string") {
      params.push(value);
      parts.push(`status::text = $${params.length}`);
    } else if (key === "status" && value && typeof value === "object" && "in" in value) {
      params.push(value.in);
      parts.push(`status::text = ANY($${params.length})`);
    } else if (key === "nextAttemptAt" && value && typeof value === "object" && "lte" in value) {
      params.push(toAdapterParam(value.lte));
      parts.push(`"nextAttemptAt" <= $${params.length}`);
    } else if (key === "telegramNotifiedAt" && value === null) {
      parts.push(`"telegramNotifiedAt" IS NULL`);
    } else {
      throw new Error(`unexpected where key ${key}`);
    }
  }
  return { clause: parts.length ? `WHERE ${parts.join(" AND ")}` : "", params };
}

const productStub = { code: "P0001", stock: 0, isActive: true, isStorefrontVisible: true };

const db = {
  $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> => {
    const text = strings.reduce((sql, part, index) => (index === 0 ? part : `${sql}$${index}${part}`), "");
    const label = labelRawStatement(text);
    statements.push(label);
    if (label === "fastPathCheck" && forceFastPathError) throw new Error("forced fast-path failure");
    const result = await pg.query(text, values.map(toAdapterParam));
    rowsReturned[label] = (rowsReturned[label] ?? 0) + result.rows.length;
    return result.rows;
  },
  productStorefrontStockInvalidation: {
    findMany: async (args: { orderBy: { requestedAt: "asc" }; take: number }): Promise<unknown[]> => {
      statements.push("stockInvalidation.findMany");
      assert.deepEqual(Object.keys(args).sort(), ["orderBy", "take"]);
      const result = await pg.query(
        `SELECT "productId", "requestedAt" FROM "ProductStorefrontStockInvalidation" ORDER BY "requestedAt" ASC LIMIT $1`,
        [args.take],
      );
      rowsReturned["stockInvalidation.findMany"] = (rowsReturned["stockInvalidation.findMany"] ?? 0) + result.rows.length;
      return result.rows;
    },
    deleteMany: async (): Promise<{ count: number }> => {
      statements.push("stockInvalidation.deleteMany");
      return { count: 0 };
    },
  },
  productStorefrontSyncState: {
    findMany: async (args: { where: SyncStateWhere; take: number }): Promise<unknown[]> => {
      const label = typeof args.where.status === "string" ? "syncState.findMany(failed)" : "syncState.findMany(candidates)";
      statements.push(label);
      const { clause, params } = syncStateWhereToSql(args.where);
      params.push(args.take);
      const result = await pg.query<Record<string, unknown>>(
        `SELECT * FROM "ProductStorefrontSyncState" ${clause} ORDER BY "nextAttemptAt" ASC LIMIT $${params.length}`,
        params,
      );
      rowsReturned[label] = (rowsReturned[label] ?? 0) + result.rows.length;
      return result.rows.map((row) => ({ ...row, product: productStub }));
    },
    updateMany: async (): Promise<{ count: number }> => {
      statements.push("syncState.updateMany");
      return { count: 0 };
    },
  },
  lineAiJob: {
    findMany: async (args: { where: { id: { in: string[] } } }): Promise<unknown[]> => {
      statements.push("lineAiJob.findMany");
      return args.where.id.in.map((id) => ({ id, payload: null, conversation: null, lineMessage: null }));
    },
    update: async (): Promise<unknown> => {
      statements.push("lineAiJob.update");
      return {};
    },
  },
  siteContent: {
    findMany: async (): Promise<unknown[]> => {
      statements.push("siteContent.findMany");
      return [];
    },
  },
};

const recoveryOptions: Array<{ quietForMs?: number; take?: number } | undefined> = [];

type StorefrontModule = typeof import("@/lib/storefront-sync");
type WorkerModule = typeof import("@/lib/line-ai-job-worker");
let storefront: StorefrontModule;
let worker: WorkerModule;

before(async () => {
  if (moduleMocksUnavailable) return;
  pg = new PGlite();
  await pg.exec(`
    SET TIME ZONE 'UTC';
    CREATE TYPE "ProductStorefrontSyncStatus" AS ENUM ('PENDING', 'PROCESSING', 'RETRYING', 'VERIFIED', 'FAILED');
    CREATE TABLE "ProductStorefrontSyncState" (
      "productId" TEXT PRIMARY KEY,
      "expectedUpdatedAt" TIMESTAMPTZ(3) NOT NULL,
      "canonicalPath" TEXT NOT NULL,
      status "ProductStorefrontSyncStatus" NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      "repairCount" INTEGER NOT NULL DEFAULT 0,
      "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL,
      "telegramNotifiedAt" TIMESTAMPTZ(3)
    );
    CREATE TABLE "ProductStorefrontStockInvalidation" (
      "productId" TEXT PRIMARY KEY,
      "requestedAt" TIMESTAMPTZ(3) NOT NULL
    );
    CREATE TYPE "LineAiJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'SKIPPED');
    CREATE TABLE "LineAiJob" (
      id TEXT PRIMARY KEY,
      status "LineAiJobStatus" NOT NULL,
      error TEXT,
      "createdAt" TIMESTAMPTZ(3) NOT NULL,
      "startedAt" TIMESTAMPTZ(3),
      "finishedAt" TIMESTAMPTZ(3)
    );
    CREATE TABLE "LineConversation" (
      id TEXT PRIMARY KEY,
      "lastInboundSeq" INTEGER NOT NULL DEFAULT 0,
      "lastProcessedSeq" INTEGER NOT NULL DEFAULT 0,
      "processingOwner" TEXT,
      "processingLeaseUntil" TIMESTAMPTZ(3),
      "lastCustomerMessageAt" TIMESTAMPTZ(3)
    );
  `);
  await mock.module("@/lib/db", { namedExports: { db } });
  await mock.module("next/cache", {
    namedExports: { revalidatePath: () => undefined, revalidateTag: () => undefined },
  });
  await mock.module("@/lib/storefront-product", {
    namedExports: { getActiveStorefrontProductById: async () => null },
  });
  await mock.module("@/lib/telegram", {
    namedExports: {
      getTelegramConfig: () => ({ botToken: "", chatIds: [], missingEnv: [] }),
      sendTelegramMessage: async () => undefined,
    },
  });
  await mock.module("@/lib/chat-core/product-search-bridge", {
    namedExports: { getChatProductSummaries: async () => [], searchChatProductInquiry: async () => null },
  });
  await mock.module("@/lib/line-messaging", {
    namedExports: { pushLineMessages: async () => undefined, replyLineMessage: async () => undefined },
  });
  const repository = await import("@/lib/line-conversation-repository");
  // Stand-in for the real recovery entry: the same single scan it starts with
  // (findStalledCoalescedConversationIds with its quietForMs / take defaults).
  await mock.module("@/lib/line-webhook-processor", {
    namedExports: {
      processLineAiReply: async () => {
        throw new Error("processLineAiReply is not expected in these tests");
      },
      recoverStalledCoalescedConversations: async (
        _config: unknown,
        _dependencies: unknown,
        options?: { quietForMs?: number; take?: number },
      ): Promise<{ scanned: number; replied: number }> => {
        recoveryOptions.push(options);
        const ids = await repository
          .findStalledCoalescedConversationIds({
            quietBefore: new Date(Date.now() - (options?.quietForMs ?? 90_000)),
            take: options?.take ?? 10,
          })
          .catch(() => [] as string[]);
        return { scanned: ids.length, replied: 0 };
      },
    },
  });
  storefront = await import("@/lib/storefront-sync");
  worker = await import("@/lib/line-ai-job-worker");
});

after(async () => {
  await pg?.close();
});

afterEach(() => {
  mock.timers.reset();
});

async function resetTables(): Promise<void> {
  await pg.exec(`
    TRUNCATE "ProductStorefrontSyncState", "ProductStorefrontStockInvalidation", "LineAiJob", "LineConversation";
  `);
}

function resetLog(): void {
  statements.length = 0;
  recoveryOptions.length = 0;
  for (const key of Object.keys(rowsReturned)) delete rowsReturned[key];
}

/** Runs fn inside a transaction that is rolled back, so the old path's writes never leak. */
async function rolledBack<R>(fn: () => Promise<R>): Promise<R> {
  await pg.exec("BEGIN");
  try {
    return await fn();
  } finally {
    await pg.exec("ROLLBACK");
  }
}

const at = (offsetMs: number): Date => new Date(T0 + offsetMs);

type StorefrontScenario = {
  name: string;
  expected: boolean;
  invalidation?: boolean;
  syncStates?: Array<{ status: string; nextAttemptOffsetMs: number; telegramNotified?: boolean }>;
};

const storefrontScenarios: StorefrontScenario[] = [
  { name: "empty queue", expected: false },
  { name: "stock invalidation row", expected: true, invalidation: true },
  { name: "PENDING due exactly now (lte)", expected: true, syncStates: [{ status: "PENDING", nextAttemptOffsetMs: 0 }] },
  { name: "PENDING due 1 ms from now", expected: false, syncStates: [{ status: "PENDING", nextAttemptOffsetMs: 1 }] },
  { name: "RETRYING overdue", expected: true, syncStates: [{ status: "RETRYING", nextAttemptOffsetMs: -1 }] },
  { name: "PROCESSING lease expired", expected: true, syncStates: [{ status: "PROCESSING", nextAttemptOffsetMs: -1 }] },
  { name: "PROCESSING lease still held", expected: false, syncStates: [{ status: "PROCESSING", nextAttemptOffsetMs: MINUTE_MS }] },
  { name: "VERIFIED overdue", expected: false, syncStates: [{ status: "VERIFIED", nextAttemptOffsetMs: -HOUR_MS }] },
  {
    name: "FAILED without Telegram alert",
    expected: true,
    syncStates: [{ status: "FAILED", nextAttemptOffsetMs: HOUR_MS, telegramNotified: false }],
  },
  {
    name: "FAILED already alerted",
    expected: false,
    syncStates: [{ status: "FAILED", nextAttemptOffsetMs: -HOUR_MS, telegramNotified: true }],
  },
];

async function seedStorefront(scenario: StorefrontScenario): Promise<void> {
  await resetTables();
  if (scenario.invalidation) {
    await pg.query(`INSERT INTO "ProductStorefrontStockInvalidation" VALUES ('p-inv', $1)`, [toAdapterParam(at(-MINUTE_MS))]);
  }
  for (const [index, state] of (scenario.syncStates ?? []).entries()) {
    await pg.query(
      `INSERT INTO "ProductStorefrontSyncState" ("productId", "expectedUpdatedAt", "canonicalPath", status, "nextAttemptAt", "telegramNotifiedAt")
       VALUES ($1, $2, '/products/x', $3::"ProductStorefrontSyncStatus", $4, $5)`,
      [
        `p-${index}`,
        toAdapterParam(at(-HOUR_MS)),
        state.status,
        toAdapterParam(at(state.nextAttemptOffsetMs)),
        state.telegramNotified ? toAdapterParam(at(-HOUR_MS)) : null,
      ],
    );
  }
}

const STOREFRONT_OLD_READS = [
  "stockInvalidation.findMany",
  "syncState.findMany(candidates)",
  "syncState.findMany(failed)",
] as const;

test("storefront fast-path check is true exactly when an old read finds a row", { skip: moduleMocksUnavailable }, async () => {
  for (const scenario of storefrontScenarios) {
    await seedStorefront(scenario);
    mock.timers.enable({ apis: ["Date"], now: T0 });

    resetLog();
    forceFastPathError = true;
    await rolledBack(() => storefront.processStorefrontSyncQueue());
    forceFastPathError = false;
    const oldFoundRow = STOREFRONT_OLD_READS.some((label) => (rowsReturned[label] ?? 0) > 0);

    const check = await storefront.hasStorefrontSyncWork(new Date());
    assert.equal(oldFoundRow, scenario.expected, `old path: ${scenario.name}`);
    assert.equal(check, scenario.expected, `fast-path check: ${scenario.name}`);
    mock.timers.reset();
  }
});

test("idle storefront tick returns the same JSON as the old path with one statement", { skip: moduleMocksUnavailable }, async () => {
  await resetTables();
  mock.timers.enable({ apis: ["Date"], now: T0 });

  resetLog();
  forceFastPathError = true;
  const oldResult = await storefront.processStorefrontSyncQueue();
  forceFastPathError = false;
  const oldStatements = [...statements];

  resetLog();
  const newResult = await storefront.processStorefrontSyncQueue();

  assert.equal(JSON.stringify({ ok: true, ...newResult }), JSON.stringify({ ok: true, ...oldResult }));
  assert.deepEqual(statements, ["fastPathCheck"]);
  assert.deepEqual(oldStatements, ["fastPathCheck", ...STOREFRONT_OLD_READS]);
});

test("busy storefront tick runs exactly the old statements in the old order", { skip: moduleMocksUnavailable }, async () => {
  await seedStorefront({
    name: "mixed",
    expected: true,
    invalidation: true,
    syncStates: [
      { status: "PENDING", nextAttemptOffsetMs: -1 },
      { status: "FAILED", nextAttemptOffsetMs: -1, telegramNotified: false },
    ],
  });
  mock.timers.enable({ apis: ["Date"], now: T0 });

  resetLog();
  forceFastPathError = true;
  const oldResult = await rolledBack(() => storefront.processStorefrontSyncQueue());
  forceFastPathError = false;
  const oldStatements = statements.slice(1);

  resetLog();
  const newResult = await rolledBack(() => storefront.processStorefrontSyncQueue());

  assert.deepEqual(newResult, oldResult);
  assert.equal(statements[0], "fastPathCheck");
  assert.deepEqual(statements.slice(1), oldStatements);
});

type LineScenario = {
  name: string;
  expected: boolean;
  jobs?: Array<{ status: string; createdOffsetMs: number; startedOffsetMs?: number | null; finished?: boolean }>;
  conversations?: Array<{
    inbound: number;
    processed: number;
    owner?: string | null;
    leaseOffsetMs?: number | null;
    lastCustomerOffsetMs: number | null;
  }>;
};

const lineScenarios: LineScenario[] = [
  { name: "no jobs, no conversations", expected: false },
  { name: "PENDING older than 60 s", expected: true, jobs: [{ status: "PENDING", createdOffsetMs: -MINUTE_MS - 1 }] },
  { name: "PENDING exactly 60 s old (strict <)", expected: false, jobs: [{ status: "PENDING", createdOffsetMs: -MINUTE_MS }] },
  { name: "PENDING fresh", expected: false, jobs: [{ status: "PENDING", createdOffsetMs: -1_000 }] },
  {
    name: "PROCESSING started over 2 min ago",
    expected: true,
    jobs: [{ status: "PROCESSING", createdOffsetMs: -HOUR_MS, startedOffsetMs: -2 * MINUTE_MS - 1 }],
  },
  {
    name: "PROCESSING started exactly 2 min ago",
    expected: false,
    jobs: [{ status: "PROCESSING", createdOffsetMs: -HOUR_MS, startedOffsetMs: -2 * MINUTE_MS }],
  },
  {
    name: "PROCESSING without startedAt falls back to createdAt",
    expected: true,
    jobs: [{ status: "PROCESSING", createdOffsetMs: -2 * MINUTE_MS - 1, startedOffsetMs: null }],
  },
  {
    name: "PROCESSING already finished",
    expected: false,
    jobs: [{ status: "PROCESSING", createdOffsetMs: -HOUR_MS, startedOffsetMs: -HOUR_MS, finished: true }],
  },
  {
    name: "old COMPLETED / FAILED / SKIPPED jobs",
    expected: false,
    jobs: [
      { status: "COMPLETED", createdOffsetMs: -HOUR_MS, startedOffsetMs: -HOUR_MS },
      { status: "FAILED", createdOffsetMs: -HOUR_MS },
      { status: "SKIPPED", createdOffsetMs: -HOUR_MS },
    ],
  },
  {
    name: "stalled conversation quiet 90 s + 1 ms",
    expected: true,
    conversations: [{ inbound: 2, processed: 1, lastCustomerOffsetMs: -90_001 }],
  },
  {
    name: "conversation quiet exactly 90 s (strict <)",
    expected: false,
    conversations: [{ inbound: 2, processed: 1, lastCustomerOffsetMs: -90_000 }],
  },
  {
    name: "conversation owned with a live lease",
    expected: false,
    conversations: [{ inbound: 2, processed: 1, owner: "live", leaseOffsetMs: HOUR_MS, lastCustomerOffsetMs: -HOUR_MS }],
  },
  {
    name: "conversation owned with an expired lease",
    expected: true,
    conversations: [{ inbound: 2, processed: 1, owner: "dead", leaseOffsetMs: -HOUR_MS, lastCustomerOffsetMs: -HOUR_MS }],
  },
  {
    name: "conversation fully answered",
    expected: false,
    conversations: [{ inbound: 3, processed: 3, lastCustomerOffsetMs: -HOUR_MS }],
  },
  {
    name: "conversation without lastCustomerMessageAt",
    expected: false,
    conversations: [{ inbound: 2, processed: 1, lastCustomerOffsetMs: null }],
  },
];

async function seedLine(scenario: LineScenario): Promise<void> {
  await resetTables();
  for (const [index, job] of (scenario.jobs ?? []).entries()) {
    await pg.query(
      `INSERT INTO "LineAiJob" (id, status, "createdAt", "startedAt", "finishedAt")
       VALUES ($1, $2::"LineAiJobStatus", $3, $4, $5)`,
      [
        `job-${index}`,
        job.status,
        toAdapterParam(at(job.createdOffsetMs)),
        job.startedOffsetMs == null ? null : toAdapterParam(at(job.startedOffsetMs)),
        job.finished ? toAdapterParam(at(-1_000)) : null,
      ],
    );
  }
  for (const [index, conversation] of (scenario.conversations ?? []).entries()) {
    await pg.query(
      `INSERT INTO "LineConversation" (id, "lastInboundSeq", "lastProcessedSeq", "processingOwner", "processingLeaseUntil", "lastCustomerMessageAt")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        `conv-${index}`,
        conversation.inbound,
        conversation.processed,
        conversation.owner ?? null,
        conversation.leaseOffsetMs == null ? null : toAdapterParam(at(conversation.leaseOffsetMs)),
        conversation.lastCustomerOffsetMs == null ? null : toAdapterParam(at(conversation.lastCustomerOffsetMs)),
      ],
    );
  }
}

const LINE_OLD_STATEMENTS = ["lineStaleProcessingUpdate", "lineClaimUpdate", "lineRecoveryScan"] as const;

test("LINE fast-path check is true exactly when an old statement touches a row", { skip: moduleMocksUnavailable }, async () => {
  for (const scenario of lineScenarios) {
    await seedLine(scenario);
    mock.timers.enable({ apis: ["Date"], now: T0 });

    resetLog();
    forceFastPathError = true;
    await rolledBack(() => worker.processPendingLineAiJobs({ take: 10 }));
    forceFastPathError = false;
    const oldFoundRow = LINE_OLD_STATEMENTS.some((label) => (rowsReturned[label] ?? 0) > 0);

    const check = await worker.hasLineAiJobWork(Date.now());
    assert.equal(oldFoundRow, scenario.expected, `old path: ${scenario.name}`);
    assert.equal(check, scenario.expected, `fast-path check: ${scenario.name}`);
    mock.timers.reset();
  }
});

test("idle LINE tick returns the same JSON without reading AI settings", { skip: moduleMocksUnavailable }, async () => {
  await resetTables();
  mock.timers.enable({ apis: ["Date"], now: T0 });

  resetLog();
  forceFastPathError = true;
  const oldSummary = await worker.processPendingLineAiJobs({ take: 10 });
  forceFastPathError = false;
  const oldStatements = [...statements];

  resetLog();
  const newSummary = await worker.processPendingLineAiJobs({ take: 10 });

  assert.equal(JSON.stringify({ ok: true, ...newSummary }), JSON.stringify({ ok: true, ...oldSummary }));
  assert.deepEqual(statements, ["fastPathCheck"]);
  assert.deepEqual(oldStatements, ["fastPathCheck", "siteContent.findMany", ...LINE_OLD_STATEMENTS]);
});

test("busy LINE tick runs exactly the old statements with the old recovery window", { skip: moduleMocksUnavailable }, async () => {
  await seedLine({
    name: "mixed",
    expected: true,
    jobs: [
      { status: "PENDING", createdOffsetMs: -2 * MINUTE_MS },
      { status: "PROCESSING", createdOffsetMs: -HOUR_MS, startedOffsetMs: -HOUR_MS },
    ],
    conversations: [{ inbound: 2, processed: 1, lastCustomerOffsetMs: -HOUR_MS }],
  });
  mock.timers.enable({ apis: ["Date"], now: T0 });

  resetLog();
  forceFastPathError = true;
  const oldSummary = await rolledBack(() => worker.processPendingLineAiJobs({ take: 10 }));
  forceFastPathError = false;
  const oldStatements = statements.slice(1);

  resetLog();
  const newSummary = await rolledBack(() => worker.processPendingLineAiJobs({ take: 10 }));

  assert.deepEqual(newSummary, oldSummary);
  assert.equal(newSummary.picked, 1);
  assert.equal(newSummary.staleProcessingFailed, 1);
  assert.equal(statements[0], "fastPathCheck");
  assert.deepEqual(statements.slice(1), oldStatements);
  assert.deepEqual(recoveryOptions, [{ quietForMs: worker.LINE_COALESCE_RECOVERY_QUIET_MS }]);
  assert.equal(worker.LINE_COALESCE_RECOVERY_QUIET_MS, 90_000);
});

test("the explicit recovery window equals recoverStalledCoalescedConversations' own default", () => {
  const source = readFileSync(path.join(process.cwd(), "lib", "line-webhook-processor.ts"), "utf8");
  assert.match(source, /const quietForMs = options\?\.quietForMs \?\? 90_000;/);
  assert.match(source, /take: options\?\.take \?\? 10,/);
});
