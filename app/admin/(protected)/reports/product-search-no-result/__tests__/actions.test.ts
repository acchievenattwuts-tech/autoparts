import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test, { before, mock } from "node:test";

import { findProductSearchQualityMetrics } from "@/lib/product-search-closed-loop";

type OutcomeRow = {
  id: string;
  normalizedQuery: string;
  candidateAction: string;
  status: string;
  baselineCount: number | null;
};
type UpsertArgs = {
  where: { normalizedQuery_candidateAction: { normalizedQuery: string; candidateAction: string } };
  create: { baselineCount: number | null; baselineAvg: number | null };
  update: Record<string, unknown>;
};
type ProductFindManyArgs = {
  where: { isActive: boolean; OR: { code?: { contains: string }; name?: { contains: string } }[] };
  take: number;
};

const calls = {
  logFindMany: 0,
  outcomeFindUnique: 0,
  productFindMany: [] as ProductFindManyArgs[],
  upserts: [] as UpsertArgs[],
};
let permitted = true;

const at = (iso: string) => new Date(iso);
const LOGS = [
  { query: "blower vigo", resultCount: 0, source: "storefront", createdAt: at("2026-09-20T01:00:00Z"), hitCount: 3 },
  { query: "Blower Vigo", resultCount: 1, source: "admin", createdAt: at("2026-09-19T01:00:00Z"), hitCount: 1 },
  { query: "compressor jazz", resultCount: 0, source: "storefront", createdAt: at("2026-09-18T01:00:00Z"), hitCount: 2 },
  { query: "radiator city", resultCount: 2, source: "storefront", createdAt: at("2026-09-17T01:00:00Z"), hitCount: 1 },
];
const OUTCOMES: OutcomeRow[] = [
  // Already has a baseline: must not be recomputed or overwritten.
  { id: "o3", normalizedQuery: "radiator city", candidateAction: "search-synonym", status: "PENDING", baselineCount: 5 },
];

class RedirectSignal extends Error {
  constructor(readonly url: string) {
    super(url);
  }
}

before(async () => {
  const tx = {
    searchSynonym: {
      create: async ({ data }: { data: { term: string } }) => ({ id: `syn-${data.term}` }),
      findUnique: async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        term: where.id,
        synonyms: [],
        language: null,
        isActive: true,
      }),
    },
    productSearchReviewOutcome: {
      upsert: async (args: UpsertArgs) => {
        calls.upserts.push(args);
        return { id: "after", ...args.where.normalizedQuery_candidateAction };
      },
    },
  };
  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        searchSynonym: { findMany: async () => [] },
        productSearchReviewOutcome: {
          findMany: async () => OUTCOMES.map((row) => ({ ...row })),
          findUnique: async () => {
            calls.outcomeFindUnique += 1;
            return null;
          },
        },
        productSearchLog: {
          findMany: async () => {
            calls.logFindMany += 1;
            return LOGS;
          },
        },
        product: {
          findMany: async (args: ProductFindManyArgs) => {
            calls.productFindMany.push(args);
            return [{ code: "P0999", name: "โบเวอร์ Vigo" }];
          },
        },
        $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
      },
    },
  });
  await mock.module("@/lib/require-auth", {
    namedExports: {
      requirePermission: async () => {
        if (!permitted) throw new Error("denied");
        return { user: { id: "u1", name: "Reviewer" } };
      },
    },
  });
  await mock.module("@/lib/site-config", {
    namedExports: { getSiteConfig: async () => ({ productSearchAutoApplySynonymsEnabled: true }) },
  });
  await mock.module("next/navigation", {
    namedExports: {
      redirect: (url: string) => {
        throw new RedirectSignal(url);
      },
    },
  });
  await mock.module("next/cache", {
    namedExports: { revalidatePath: () => undefined, updateTag: () => undefined },
  });
  await mock.module("@/lib/audit-log", {
    namedExports: {
      diffEntity: (beforeValue: unknown, afterValue: unknown) => ({ before: beforeValue, after: afterValue }),
      getAuditActorFromSession: () => ({ userId: "u1" }),
      getRequestContext: async () => ({}),
      safeWriteAuditLog: async () => undefined,
    },
  });
  await mock.module("@/lib/search-synonyms", {
    namedExports: { SEARCH_SYNONYM_CACHE_TAG: "search-synonyms" },
  });
  await mock.module("@/lib/storefront-revalidation", {
    namedExports: { revalidateStorefrontCaches: async () => undefined },
  });
});

test("auto-apply reads the baseline log window once and keeps per-query baselines identical", async () => {
  const { autoApplySearchSynonymCandidates } = await import("../actions");
  const formData = new FormData();
  formData.set(
    "candidates",
    JSON.stringify([
      { normalizedQuery: "blower vigo", rawQueries: ["blower vigo", "โบเวอร์ vigo"] },
      { normalizedQuery: "compressor jazz", rawQueries: ["compressor jazz", "คอมแอร์ jazz"] },
      { normalizedQuery: "radiator city", rawQueries: ["radiator city", "หม้อน้ำ city"] },
    ]),
  );

  await assert.rejects(autoApplySearchSynonymCandidates(formData), (error: unknown) => {
    assert.ok(error instanceof RedirectSignal);
    assert.equal(new URL(error.url, "https://x").searchParams.get("f2Applied"), "Auto-applied 3 SearchSynonym candidate(s)");
    return true;
  });

  assert.equal(calls.logFindMany, 1, "baseline logs are fetched once per batch");
  assert.equal(calls.outcomeFindUnique, 0, "before-snapshots come from one findMany");
  assert.equal(calls.upserts.length, 3);

  const byQuery = new Map(
    calls.upserts.map((args) => [args.where.normalizedQuery_candidateAction.normalizedQuery, args]),
  );
  for (const query of ["blower vigo", "compressor jazz"]) {
    const expected = findProductSearchQualityMetrics(LOGS, query);
    assert.ok(expected);
    const args = byQuery.get(query);
    assert.ok(args);
    assert.equal(args.create.baselineCount, expected.count);
    assert.equal(args.create.baselineAvg, expected.avgResultCount);
    assert.equal(args.update.baselineCount, expected.count);
  }
  // Existing baseline kept: no baseline fields in the update branch.
  const radiator = byQuery.get("radiator city");
  assert.ok(radiator);
  assert.equal("baselineCount" in radiator.update, false);
});

test("product picker search covers every active product by code or name, gated by permission", async () => {
  const { searchProductCodeOptions } = await import("../actions");

  assert.deepEqual(await searchProductCodeOptions("vigo"), [
    { id: "P0999", label: "P0999", sublabel: "โบเวอร์ Vigo" },
  ]);
  const args = calls.productFindMany.at(-1);
  assert.ok(args);
  assert.equal(args.where.isActive, true);
  assert.deepEqual(
    args.where.OR.map((clause) => clause.code?.contains ?? clause.name?.contains),
    ["vigo", "vigo"],
  );

  const callsBefore = calls.productFindMany.length;
  assert.deepEqual(await searchProductCodeOptions("v"), []);
  permitted = false;
  assert.deepEqual(await searchProductCodeOptions("vigo"), []);
  permitted = true;
  assert.equal(calls.productFindMany.length, callsBefore);
});

test("FlashMessage is keyed by its message so every new flash remounts it", () => {
  const page = readFileSync(
    path.join(process.cwd(), "app/admin/(protected)/reports/product-search-no-result/page.tsx"),
    "utf8",
  );
  assert.match(page, /<FlashMessage key=\{`\$\{f2Applied\}\\u0000\$\{f2Error\}`\}/);
});
