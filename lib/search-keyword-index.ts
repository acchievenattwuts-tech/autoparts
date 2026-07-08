import { after } from "next/server";
import { db } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma";
import { normalizeSearchText } from "@/lib/search-normalization";

/**
 * Keyword-first autocomplete index (Shopee-style).
 *
 * The as-you-type dropdown queries this pre-computed table with a single indexed
 * prefix lookup instead of running the heavy V2 product search (trigram +
 * transaction + optional embedding) on every keystroke. The real product search
 * only fires once, on submit (see lib/storefront-search-intent.ts).
 *
 * Rows are derived entirely from data the system already holds — master tables,
 * product keyword_text, SearchSynonym, and successful search logs — so nothing is
 * fabricated. Refresh runs from prisma/scripts/refresh-search-keywords.ts and is
 * also triggered after catalog/master mutations via the storefront revalidate hook.
 */

export type SearchKeywordKind =
  | "category"
  | "partsBrand"
  | "carBrand"
  | "carModel"
  | "product"
  | "synonym";

export type SearchKeywordSuggestion = {
  term: string;
  kind: SearchKeywordKind;
  sublabel: string | null;
};

export type SearchKeywordRefreshOutcome = {
  rowsBuilt: number;
  rowsWritten: number;
  batches: number;
  skipped: "EMPTY" | "LOCKED" | null;
};

const MAX_TERM_LENGTH = 120;
const SEARCH_KEYWORD_REFRESH_LOCK_NAMESPACE = 24_061;
const SEARCH_KEYWORD_REFRESH_LOCK_KEY = 1;
const SEARCH_KEYWORD_UPSERT_BATCH_SIZE = 250;
const REFRESH_TX_TIMEOUT_MS = 110_000;
const REFRESH_TX_MAX_WAIT_MS = 10_000;
const REFRESH_TX_LOCK_TIMEOUT_MS = 8_000;
const REFRESH_TX_IDLE_IN_TX_TIMEOUT_MS = 30_000;
const REFRESH_STATEMENT_TIMEOUT_MS = 25_000;

type DraftRow = {
  term: string;
  normalized: string;
  kind: SearchKeywordKind;
  sublabel: string | null;
  popularity: number;
};

/**
 * Builds one normalized draft row, or null when empty/too short.
 *
 * `normalizedSource` lets a colloquial alias drive the lookup key while `term`
 * stays the canonical display/filter value — e.g. a CategoryAlias "ผ้าเบรค" maps
 * to term "ผ้าเบรค (Brake Pad)" with normalized = "ผ้าเบรค", so a bare customer
 * word both matches AND yields the exact category name for the hard filter.
 */
const draft = (
  term: string | null | undefined,
  kind: SearchKeywordKind,
  popularity: number,
  sublabel: string | null = null,
  normalizedSource?: string | null,
): DraftRow | null => {
  const trimmed = term?.trim();
  if (!trimmed) return null;
  const normalized = normalizeSearchText(normalizedSource?.trim() || trimmed);
  if (!normalized || normalized.length < 2) return null;
  return {
    term: trimmed.slice(0, MAX_TERM_LENGTH),
    normalized: normalized.slice(0, MAX_TERM_LENGTH),
    kind,
    sublabel: sublabel?.trim().slice(0, MAX_TERM_LENGTH) || null,
    popularity,
  };
};

export function buildSynonymKeywordDrafts(
  synonyms: Array<{ term: string; synonyms?: string[] | null }>,
): DraftRow[] {
  const rows: DraftRow[] = [];
  for (const synonym of synonyms) {
    const canonical = draft(synonym.term, "synonym", 300);
    if (canonical) rows.push(canonical);
    for (const alias of synonym.synonyms ?? []) {
      const aliasRow = draft(synonym.term, "synonym", 300, null, alias);
      if (aliasRow) rows.push(aliasRow);
    }
  }
  return rows;
}

/**
 * Collects keyword draft rows from every source. De-duped by (normalized, kind),
 * keeping the highest popularity so the strongest signal wins.
 */
export async function buildSearchKeywordRows(): Promise<DraftRow[]> {
  const [categories, categoryAliases, partsBrands, carBrands, carModels, products, synonyms, hotLogs] =
    await Promise.all([
      db.category.findMany({ where: { isActive: true }, select: { name: true } }),
      // Curated colloquial → category aliases. Stored with normalized = the alias
      // (what customers type) but term = the canonical category name (the exact
      // hard-filter value), so a bare "ผ้าเบรค" / "วาล์ว" becomes a known query.
      db.categoryAlias.findMany({
        where: { isActive: true, kind: "MATCH", category: { isActive: true } },
        select: { alias: true, category: { select: { name: true } } },
      }),
      db.partsBrand.findMany({ where: { isActive: true }, select: { name: true } }),
      db.carBrand.findMany({ where: { isActive: true }, select: { name: true } }),
      db.carModel.findMany({
        where: { isActive: true },
        select: { name: true, carBrand: { select: { name: true } } },
      }),
      // Product names drive long-tail suggestions; in-stock items rank a touch higher.
      db.product.findMany({
        where: { isActive: true, isStorefrontVisible: true },
        select: { name: true, stock: true },
        take: 5000,
      }),
      db.searchSynonym.findMany({ where: { isActive: true }, select: { term: true, synonyms: true } }),
      // Only queries that DID return results become suggestions — never dead ends.
      db.productSearchLog.findMany({
        where: { resultCount: { gt: 0 }, isBot: false },
        select: { query: true, hitCount: true },
        orderBy: { hitCount: "desc" },
        take: 500,
      }),
    ]);

  const drafts: Array<DraftRow | null> = [];

  for (const c of categories) drafts.push(draft(c.name, "category", 1_000, "หมวดหมู่"));
  for (const a of categoryAliases)
    drafts.push(draft(a.category?.name, "category", 950, "หมวดหมู่", a.alias));
  for (const b of partsBrands) drafts.push(draft(b.name, "partsBrand", 800, "ยี่ห้ออะไหล่"));
  for (const b of carBrands) drafts.push(draft(b.name, "carBrand", 900, "ยี่ห้อรถ"));
  for (const m of carModels)
    drafts.push(draft(m.name, "carModel", 700, m.carBrand?.name ?? "รุ่นรถ"));
  for (const p of products)
    drafts.push(draft(p.name, "product", 100 + (p.stock > 0 ? 50 : 0), "สินค้า"));
  drafts.push(...buildSynonymKeywordDrafts(synonyms));
  for (const l of hotLogs)
    drafts.push(draft(l.query, "synonym", 200 + Math.min(l.hitCount, 100)));

  // De-dupe by (normalized, kind), keeping the highest popularity.
  const byKey = new Map<string, DraftRow>();
  for (const row of drafts) {
    if (!row) continue;
    const key = `${row.normalized}|${row.kind}`;
    const existing = byKey.get(key);
    if (!existing || row.popularity > existing.popularity) byKey.set(key, row);
  }
  return Array.from(byKey.values());
}

/**
 * Rebuilds the SearchKeyword index transactionally via batched upserts plus one
 * stale-delete. The heavy row build stays outside the transaction; only the DB
 * write phase is serialized. A transaction-scoped advisory lock prevents
 * multiple serverless instances from trying to rebuild the same index at once,
 * and batching avoids one giant VALUES statement as the catalog grows.
 */
type SearchKeywordTxLike = {
  $executeRaw: (query: Prisma.Sql) => Promise<unknown>;
  $queryRaw: <T = unknown>(query: Prisma.Sql) => Promise<T>;
};

type SearchKeywordRefreshDeps = {
  buildRows: () => Promise<DraftRow[]>;
  now: () => Date;
  batchSize?: number;
  log?: Pick<typeof console, "info" | "warn" | "error">;
  runTx: <T>(fn: (tx: SearchKeywordTxLike) => Promise<T>) => Promise<T>;
};

function chunkDraftRows(rows: DraftRow[], batchSize: number): DraftRow[][] {
  const size = Math.max(1, Math.floor(batchSize));
  const chunks: DraftRow[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

function buildSearchKeywordUpsertSql(rows: DraftRow[], runStartedAt: Date): Prisma.Sql {
  return Prisma.sql`
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
}

function runRefreshTransaction<T>(fn: (tx: SearchKeywordTxLike) => Promise<T>): Promise<T> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`
        SELECT set_config('lock_timeout', ${String(REFRESH_TX_LOCK_TIMEOUT_MS)}, true)
      `;
      await tx.$executeRaw`
        SELECT set_config('idle_in_transaction_session_timeout', ${String(REFRESH_TX_IDLE_IN_TX_TIMEOUT_MS)}, true)
      `;
      await tx.$executeRaw`
        SELECT set_config('statement_timeout', ${String(REFRESH_STATEMENT_TIMEOUT_MS)}, true)
      `;
      return fn(tx);
    },
    { timeout: REFRESH_TX_TIMEOUT_MS, maxWait: REFRESH_TX_MAX_WAIT_MS },
  ) as Promise<T>;
}

export async function runSearchKeywordRefreshWithDeps(
  deps: SearchKeywordRefreshDeps,
): Promise<SearchKeywordRefreshOutcome> {
  const startedAtMs = Date.now();
  const rows = await deps.buildRows();
  if (rows.length === 0) {
    deps.log?.warn("[search-keyword] refresh skipped because the rebuilt index was empty");
    return { rowsBuilt: 0, rowsWritten: 0, batches: 0, skipped: "EMPTY" };
  }

  const runStartedAt = deps.now();
  const batches = chunkDraftRows(rows, deps.batchSize ?? SEARCH_KEYWORD_UPSERT_BATCH_SIZE);

  const outcome = await deps.runTx(async (tx) => {
    const lockRows = await tx.$queryRaw<Array<{ acquired: boolean }>>(Prisma.sql`
      SELECT pg_try_advisory_xact_lock(
        ${SEARCH_KEYWORD_REFRESH_LOCK_NAMESPACE},
        ${SEARCH_KEYWORD_REFRESH_LOCK_KEY}
      ) AS "acquired"
    `);

    if (!lockRows[0]?.acquired) {
      const lockedOutcome: SearchKeywordRefreshOutcome = {
        rowsBuilt: rows.length,
        rowsWritten: 0,
        batches: 0,
        skipped: "LOCKED",
      };
      return lockedOutcome;
    }

    for (const batch of batches) {
      await tx.$executeRaw(buildSearchKeywordUpsertSql(batch, runStartedAt));
    }

    await tx.$executeRaw(Prisma.sql`
      DELETE FROM "SearchKeyword" WHERE "updatedAt" < ${runStartedAt}
    `);

    const successOutcome: SearchKeywordRefreshOutcome = {
      rowsBuilt: rows.length,
      rowsWritten: rows.length,
      batches: batches.length,
      skipped: null,
    };
    return successOutcome;
  });

  if (outcome.skipped === "LOCKED") {
    deps.log?.info(
      `[search-keyword] refresh skipped because another instance already holds the advisory lock (${rows.length} rows built)`,
    );
    return outcome;
  }

  deps.log?.info(
    `[search-keyword] refresh completed: built ${outcome.rowsBuilt} rows, wrote ${outcome.rowsWritten} rows in ${outcome.batches} batch(es) (${Date.now() - startedAtMs} ms)`,
  );
  return outcome;
}

export async function refreshSearchKeywordIndex(): Promise<number> {
  const outcome = await runSearchKeywordRefreshWithDeps({
    buildRows: buildSearchKeywordRows,
    now: () => new Date(),
    batchSize: SEARCH_KEYWORD_UPSERT_BATCH_SIZE,
    log: console,
    runTx: runRefreshTransaction,
  });

  return outcome.rowsWritten;
}

/**
 * Fire-and-forget index refresh for use inside Server Actions / route handlers
 * after a catalog or master-data mutation. Never awaited, never throws — a refresh
 * failure must not affect the business operation that triggered it. This is a
 * best-effort "make the dropdown fresh sooner"; the daily cron remains the
 * guaranteed catch-all (and on serverless a fire-and-forget may be cut off, which
 * is exactly why the cron exists).
 */
// In-process coalescing guard. A single master-data save fans out into several
// revalidate hooks (and a rapid sequence of edits fires many), each calling this.
// Without coalescing they would all start a rebuild at once, piling concurrent
// transactions onto the small per-instance pool (max 5) and starving it — the
// exact contention behind the P2028 cascade. So: while a rebuild is in flight we
// don't start another; instead we mark "rerun pending" so exactly one more run
// fires afterwards to capture the latest data. Cross-instance overlap is handled
// separately by the transaction-scoped advisory lock inside refreshSearchKeywordIndex.
let inFlightRefresh: Promise<void> | null = null;
let rerunPending = false;

function runRefreshCoalesced(): Promise<void> {
  inFlightRefresh = refreshSearchKeywordIndex()
    .then(() => undefined)
    .catch((error) => {
      console.error("[search-keyword] background refresh failed", error);
    })
    .finally(() => {
      inFlightRefresh = null;
      if (rerunPending) {
        rerunPending = false;
        void runRefreshCoalesced();
      }
    });
  return inFlightRefresh;
}

export function triggerSearchKeywordRefresh(): void {
  if (inFlightRefresh) {
    // A rebuild is already running — guarantee one more run picks up this change.
    rerunPending = true;
    return;
  }
  // Run the rebuild via `after()` so on Vercel the function stays alive (waitUntil)
  // until the transaction finishes, instead of returning the response and freezing
  // the instance mid-transaction. A frozen instance let wall-clock time run past the
  // transaction timeout window, producing the P2028 "expired transaction" errors.
  // `after()` requires a request scope; if we're somehow outside one (e.g. a script),
  // fall back to a plain fire-and-forget.
  try {
    after(() => runRefreshCoalesced());
  } catch {
    void runRefreshCoalesced();
  }
}

const MAX_SUGGESTIONS = 16;

/**
 * Prefix lookup for the autocomplete dropdown. Single indexed query (btree on
 * `normalized`), accent-folded, ordered by popularity. Matches a prefix on the
 * whole term OR on any internal word so "ปู" surfaces "ตะปู…" style results.
 */
export async function querySearchKeywords(
  rawQuery: string,
  limit = MAX_SUGGESTIONS,
): Promise<SearchKeywordSuggestion[]> {
  const normalized = normalizeSearchText(rawQuery);
  if (!normalized || normalized.length < 2) return [];

  const prefix = `${normalized}%`;
  const wordPrefix = `% ${normalized}%`;
  const take = Math.min(Math.max(limit, 1), MAX_SUGGESTIONS);

  // Over-fetch then de-dupe by display term: several colloquial aliases can map to
  // the same canonical category, which would otherwise repeat in the dropdown.
  const rows = await db.$queryRaw<Array<{ term: string; kind: string; sublabel: string | null }>>(
    Prisma.sql`
      SELECT term, kind, sublabel
      FROM "SearchKeyword"
      WHERE normalized LIKE ${prefix} OR normalized LIKE ${wordPrefix}
      ORDER BY (normalized LIKE ${prefix}) DESC, popularity DESC, length(term) ASC
      LIMIT ${take * 3}
    `,
  );

  const seen = new Set<string>();
  const out: SearchKeywordSuggestion[] = [];
  for (const row of rows) {
    const key = row.term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ term: row.term, kind: row.kind as SearchKeywordKind, sublabel: row.sublabel });
    if (out.length >= take) break;
  }
  return out;
}
