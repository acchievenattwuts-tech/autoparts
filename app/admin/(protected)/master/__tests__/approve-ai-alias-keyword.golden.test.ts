import assert from "node:assert/strict";
import test, { after, before, mock } from "node:test";
import { PGlite, type Transaction } from "@electric-sql/pglite";

import { Prisma } from "@/lib/generated/prisma";

/**
 * Approving an AI-suggested category alias must leave its spelling correction
 * (misspelling → corrected term) in the SearchKeyword index after every rebuild.
 *
 * Runs the real path: approveAiCategoryAlias() → triggerSearchKeywordRefresh()
 * → after() task → refreshSearchKeywordIndex() → buildSearchKeywordRows() over an
 * in-memory master store → the real rebuild SQL on an in-process Postgres (PGlite).
 * Every row that existed before the approval must come out byte-for-byte the same
 * (same id, timestamps and physical tuple), and the builder must produce exactly
 * the rows it produced before this fix when no approved AI correction exists.
 */

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type AliasRow = {
  id: string;
  categoryId: string | null;
  alias: string;
  kind: "MATCH" | "SKIP_CATEGORY";
  matchMode: "EXACT" | "CONTAINS" | "TOKEN";
  priority: number;
  isActive: boolean;
  notes: string | null;
  source: "MANUAL" | "AI_AUTO";
  reviewStatus: "APPROVED" | "PENDING" | "REJECTED";
  aiCorrectedTerm: string | null;
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
  xmin: string;
  ctid: string;
};

type DraftRow = { term: string; normalized: string; kind: string; sublabel: string | null; popularity: number };

const COMPRESSOR = "คอมเพรสเซอร์ (Compressor)";
const categories = [
  { id: "catcomp", name: COMPRESSOR, isActive: true },
  { id: "catpad", name: "ผ้าเบรค (Brake Pad)", isActive: true },
  { id: "catvalve", name: "วาล์วแอร์ (Expansion Valve)", isActive: true },
  { id: "catalt", name: "ไดชาร์จ (Alternator)", isActive: true },
  { id: "catold", name: "หมวดเก่า", isActive: false },
];

const aliasRow = (row: Partial<AliasRow> & Pick<AliasRow, "id" | "categoryId" | "alias">): AliasRow => ({
  kind: "MATCH",
  matchMode: "CONTAINS",
  priority: 0,
  isActive: true,
  notes: null,
  source: "MANUAL",
  reviewStatus: "APPROVED",
  aiCorrectedTerm: null,
  ...row,
});

/** An AI suggestion as stageAiCategoryAlias() leaves it. */
const aiSuggestion = (id: string, categoryId: string, alias: string, aiCorrectedTerm: string): AliasRow =>
  aliasRow({
    id,
    categoryId,
    alias,
    matchMode: "EXACT",
    priority: 200,
    isActive: false,
    source: "AI_AUTO",
    reviewStatus: "PENDING",
    aiCorrectedTerm,
  });

const approved = (row: AliasRow): AliasRow => ({ ...row, isActive: true, reviewStatus: "APPROVED" });

const baseAliases = (): AliasRow[] => [
  aliasRow({ id: "aliasmanual", categoryId: "catpad", alias: "ผ้าเบรค" }),
  aliasRow({ id: "aliasskip", categoryId: "catpad", alias: "ยาง", kind: "SKIP_CATEGORY" }),
  aiSuggestion("aipending", "catcomp", "คอมมแอร์", "คอมเพรสเซอร์แอร์"),
  // Same misspelling as a SearchSynonym alias row.
  aiSuggestion("aicollide", "catvalve", "วาว์ล", "วาล์ว"),
  // Same misspelling as a successful search-log query.
  aiSuggestion("aihot", "catalt", "ไดชาด", "ไดชาร์จ"),
  aiSuggestion("aiwaiting", "catcomp", "คอมเพสเซอ", "คอมเพรสเซอร์"),
  { ...aiSuggestion("airejected", "catpad", "ผ้าเบก", "ผ้าเบรก"), reviewStatus: "REJECTED" },
];

let aliases: AliasRow[] = baseAliases();
/** True = project CategoryAlias rows the way the keyword build saw them before this fix. */
let hideAiCorrections = false;

const categoryOf = (id: string | null) => categories.find((category) => category.id === id) ?? null;

const project = (row: AliasRow, select: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(select)) {
    if (key === "category") {
      const category = categoryOf(row.categoryId);
      out.category = category ? { name: category.name } : null;
    } else if (hideAiCorrections && key === "aiCorrectedTerm") {
      out[key] = null;
    } else {
      out[key] = row[key as keyof AliasRow];
    }
  }
  return out;
};

type AliasWhere = { id?: string; isActive?: boolean; kind?: string; category?: { isActive?: boolean } };

const matchesWhere = (row: AliasRow, where: AliasWhere): boolean =>
  (where.isActive === undefined || row.isActive === where.isActive) &&
  (where.kind === undefined || row.kind === where.kind) &&
  (where.category?.isActive === undefined || categoryOf(row.categoryId)?.isActive === where.category.isActive);

// ── In-process Postgres standing in for the SearchKeyword table ─────────────
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
`;

let pg: PGlite;
const writes = { affectedRows: 0 };

/** Same parameter handling as @prisma/adapter-pg: Dates go out as zone-less UTC strings. */
const toAdapterParam = (value: unknown): unknown =>
  value instanceof Date ? value.toISOString().replace("T", " ").replace("Z", "") : value;

type SqlInput = TemplateStringsArray | Prisma.Sql;
/** tx.$executeRaw is called both as a tagged template and with a built Prisma.sql. */
const toSql = (first: SqlInput, values: Prisma.Sql["values"]): Prisma.Sql =>
  "text" in first ? first : Prisma.sql(first, ...values);

const wrapTx = (tx: Transaction) => ({
  $executeRaw: async (first: SqlInput, ...values: Prisma.Sql["values"]): Promise<number> => {
    const sql = toSql(first, values);
    const result = await tx.query(sql.text, sql.values.map(toAdapterParam));
    const affected = /^\s*select\b/i.test(sql.text) ? 0 : (result.affectedRows ?? 0);
    writes.affectedRows += affected;
    return affected;
  },
  $queryRaw: async <T>(first: SqlInput, ...values: Prisma.Sql["values"]): Promise<T> => {
    const sql = toSql(first, values);
    const result = await tx.query(sql.text, sql.values.map(toAdapterParam));
    return result.rows as T;
  },
});

const fakeDb = {
  category: {
    findMany: async ({ where }: { where?: { isActive?: boolean } }) =>
      categories
        .filter((category) => where?.isActive === undefined || category.isActive === where.isActive)
        .map((category) => ({ name: category.name })),
  },
  categoryAlias: {
    findMany: async ({ where, select }: { where: AliasWhere; select: Record<string, unknown> }) =>
      aliases.filter((row) => matchesWhere(row, where)).map((row) => project(row, select)),
    findUnique: async ({ where, select }: { where: { id: string }; select: Record<string, unknown> }) => {
      const row = aliases.find((alias) => alias.id === where.id);
      return row ? project(row, select) : null;
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<AliasRow> }) => {
      const row = aliases.find((alias) => alias.id === where.id);
      assert.ok(row, `alias ${where.id} exists`);
      Object.assign(row, data);
      return row;
    },
  },
  partsBrand: { findMany: async () => [{ name: "Denso" }] },
  carBrand: { findMany: async () => [{ name: "Toyota" }] },
  carModel: { findMany: async () => [{ name: "Vios", carBrand: { name: "Toyota" } }] },
  product: { findMany: async () => [{ name: "คอมแอร์ Vios", stock: 2 }] },
  searchSynonym: { findMany: async () => [{ term: "Expansion Valve", synonyms: ["วาว์ล"] }] },
  productSearchLog: { findMany: async () => [{ query: "ไดชาด", hitCount: 10 }] },
  searchKeyword: {
    upsert: async (): Promise<never> => {
      throw new Error("the approval must not write SearchKeyword rows the rebuild does not build");
    },
  },
  $transaction: async <T>(fn: (tx: ReturnType<typeof wrapTx>) => Promise<T>): Promise<T> =>
    pg.transaction((tx) => fn(wrapTx(tx))),
};

const afterTasks: Array<() => unknown> = [];
const refreshErrors: unknown[][] = [];

before(async () => {
  if (moduleMocksUnavailable) return;
  pg = new PGlite();
  await pg.exec(SCHEMA);

  await mock.module("next/server", {
    namedExports: { after: (task: () => unknown) => void afterTasks.push(task) },
  });
  await mock.module("next/cache", {
    namedExports: {
      updateTag: () => undefined,
      revalidatePath: () => undefined,
      revalidateTag: () => undefined,
      unstable_cache: <T>(fn: T): T => fn,
    },
  });
  await mock.module("@/lib/db", {
    namedExports: {
      db: fakeDb,
      isTransientDbError: () => false,
      withDbRetry: async <T>(fn: () => Promise<T>) => fn(),
    },
  });
  await mock.module("@/lib/require-auth", {
    namedExports: {
      requirePermission: async () => ({ user: { id: "u1" } }),
      requireAnyPermission: async () => ({ user: { id: "u1" } }),
    },
  });
  await mock.module("@/lib/audit-log", {
    namedExports: {
      diffEntity: (beforeValue: unknown, afterValue: unknown) => ({ before: beforeValue, after: afterValue }),
      getAuditActorFromSession: () => ({ userId: "u1" }),
      getRequestContext: async () => ({}),
      safeWriteAuditLog: async () => undefined,
    },
  });
  await mock.module("@/lib/product-search-cache", { namedExports: { updateProductSearchCache: () => undefined } });
  await mock.module("@/lib/products-bucket-storage", {
    namedExports: {
      deleteCategoryImageObjects: async () => undefined,
      isOwnedBlobCategoryImageUrl: () => true,
      uploadProductsBucketObject: async () => "",
    },
  });
  await mock.module("@/lib/storefront-revalidation", {
    namedExports: { refreshCategoryStorefrontCaches: async () => undefined },
  });
  await mock.module("@/lib/category-alias-cache", { namedExports: { invalidateCategoryAliasCache: () => undefined } });
  await mock.module("@/lib/transaction-options", {
    namedExports: { invalidateTransactionProductOptions: () => undefined },
  });

  mock.method(console, "info", () => undefined);
  mock.method(console, "error", (...args: unknown[]) => {
    if (String(args[0]).startsWith("[search-keyword]")) refreshErrors.push(args);
  });
});

after(async () => {
  await pg?.close();
});

/** Runs the rebuilds the actions handed to after(), like Vercel's waitUntil would. */
const drainAfterTasks = async (): Promise<number> => {
  let ran = 0;
  while (afterTasks.length > 0) {
    const task = afterTasks.shift();
    await task?.();
    ran += 1;
  }
  assert.deepEqual(refreshErrors, [], "the rebuild did not fail");
  return ran;
};

const readTable = async (): Promise<TableRow[]> =>
  (
    await pg.query<TableRow>(
      `SELECT "id", "term", "normalized", "kind", "sublabel", "popularity", "createdAt", "updatedAt",
              xmin::text AS xmin, ctid::text AS ctid
       FROM "SearchKeyword" ORDER BY "normalized", "kind"`,
    )
  ).rows;

const keyOf = (row: { normalized: string; kind: string }): string => `${row.normalized}|${row.kind}`;
const appRow = (row: TableRow | DraftRow): DraftRow => ({
  term: row.term,
  normalized: row.normalized,
  kind: row.kind,
  sublabel: row.sublabel,
  popularity: row.popularity,
});
const sortByKey = (rows: DraftRow[]): DraftRow[] => [...rows].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));

/** Every row of `beforeRows` is still there and physically untouched; returns the rows that are new. */
const assertUntouched = (beforeRows: TableRow[], afterRows: TableRow[]): TableRow[] => {
  const afterByKey = new Map(afterRows.map((row) => [keyOf(row), row]));
  for (const row of beforeRows) {
    assert.deepEqual(afterByKey.get(keyOf(row)), row, `${keyOf(row)} is unchanged`);
  }
  const beforeKeys = new Set(beforeRows.map(keyOf));
  return afterRows.filter((row) => !beforeKeys.has(keyOf(row)));
};

test("builder: approved AI corrections only add their own synonym rows; every other row is as before", { skip: moduleMocksUnavailable }, async () => {
  const { buildSearchKeywordRows } = await import("@/lib/search-keyword-index");
  aliases = baseAliases().map((row) =>
    ["aipending", "aicollide", "aihot"].includes(row.id) ? approved(row) : row,
  );
  // Approved, but its category is switched off: like its category row, not indexed.
  aliases.push(approved(aiSuggestion("aioldcat", "catold", "หมวดก่า", "หมวดเก่า")));

  hideAiCorrections = true;
  const previousRows = await buildSearchKeywordRows();
  hideAiCorrections = false;
  const currentRows = await buildSearchKeywordRows();

  assert.deepEqual(currentRows.slice(0, previousRows.length), previousRows, "same rows, same order");
  assert.deepEqual(currentRows.slice(previousRows.length), [
    { term: "คอมเพรสเซอร์แอร์", normalized: "คอมมแอร์", kind: "synonym", sublabel: null, popularity: 300 },
  ]);

  const byKey = new Map(currentRows.map((row) => [keyOf(row), appRow(row)]));
  // The rows the other sources build keep winning on the same misspelling.
  assert.deepEqual(byKey.get("วาว์ล|synonym"), {
    term: "Expansion Valve",
    normalized: "วาว์ล",
    kind: "synonym",
    sublabel: null,
    popularity: 300,
  });
  assert.deepEqual(byKey.get("ไดชาด|synonym"), {
    term: "ไดชาด",
    normalized: "ไดชาด",
    kind: "synonym",
    sublabel: null,
    popularity: 210,
  });
  assert.ok(!byKey.has("หมวดก่า|synonym"));
  assert.ok(!byKey.has("คอมเพสเซอ|synonym"), "a suggestion still waiting for review is not indexed");
  assert.ok(!byKey.has("ผ้าเบก|synonym"), "a rejected suggestion is not indexed");
});

let beforeApproval: TableRow[] = [];
let afterApproval: TableRow[] = [];

test("approve → rebuild: the approved correction is in the index and nothing else changed", { skip: moduleMocksUnavailable }, async () => {
  const { refreshSearchKeywordIndex } = await import("@/lib/search-keyword-index");
  const { approveAiCategoryAlias } = await import("../categories/actions");

  aliases = baseAliases();
  await refreshSearchKeywordIndex(); // the index as the nightly cron left it
  beforeApproval = await readTable();
  assert.ok(beforeApproval.length > 0);
  assert.ok(!beforeApproval.some((row) => row.normalized === "คอมมแอร์"));

  assert.deepEqual(await approveAiCategoryAlias("aipending"), {});
  assert.equal(await drainAfterTasks(), 1, "the approval triggers one rebuild");

  afterApproval = await readTable();
  const added = assertUntouched(beforeApproval, afterApproval);
  assert.deepEqual(
    sortByKey(added.map(appRow)),
    sortByKey([
      // Built from the active alias, as before this fix.
      { term: COMPRESSOR, normalized: "คอมมแอร์", kind: "category", sublabel: "หมวดหมู่", popularity: 950 },
      // The approved correction — what used to vanish.
      { term: "คอมเพรสเซอร์แอร์", normalized: "คอมมแอร์", kind: "synonym", sublabel: null, popularity: 300 },
    ]),
  );
});

test("later rebuilds (cron, other saves) keep the approved correction and write nothing", { skip: moduleMocksUnavailable }, async () => {
  const { refreshSearchKeywordIndex } = await import("@/lib/search-keyword-index");
  writes.affectedRows = 0;
  await refreshSearchKeywordIndex();
  await refreshSearchKeywordIndex();

  assert.equal(writes.affectedRows, 0, "no insert, update or delete");
  assert.deepEqual(await readTable(), afterApproval, "every tuple is the same physical version");
});

test("approving a misspelling another source already indexes leaves that row untouched", { skip: moduleMocksUnavailable }, async () => {
  const { approveAiCategoryAlias } = await import("../categories/actions");
  const beforeRows = await readTable();

  assert.deepEqual(await approveAiCategoryAlias("aicollide"), {});
  assert.deepEqual(await approveAiCategoryAlias("aihot"), {});
  await drainAfterTasks();

  const added = assertUntouched(beforeRows, await readTable());
  assert.deepEqual(added.map(keyOf).sort(), ["ไดชาด|category", "วาว์ล|category"].sort());
});

test("switching the approved alias off removes its correction with it", { skip: moduleMocksUnavailable }, async () => {
  const { toggleCategoryAlias } = await import("../categories/actions");
  const beforeRows = await readTable();

  assert.deepEqual(await toggleCategoryAlias("aipending", false), {});
  assert.equal(await drainAfterTasks(), 1);

  const afterRows = await readTable();
  assert.ok(!afterRows.some((row) => row.normalized === "คอมมแอร์"));
  assert.deepEqual(
    assertUntouched(
      afterRows,
      beforeRows.filter((row) => row.normalized !== "คอมมแอร์"),
    ),
    [],
  );
});
