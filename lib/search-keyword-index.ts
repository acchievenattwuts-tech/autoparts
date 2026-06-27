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

const MAX_TERM_LENGTH = 120;

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
      db.searchSynonym.findMany({ where: { isActive: true }, select: { term: true } }),
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
  for (const s of synonyms) drafts.push(draft(s.term, "synonym", 300));
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
 * Rebuilds the entire SearchKeyword index transactionally (delete-all + bulk
 * insert). Cheap because the catalog is small (≈800 products). Returns the row
 * count written. Uses upsert (ON CONFLICT) keyed by the unique (normalized, kind)
 * pair plus a stale-delete, so existing rows keep their id / createdAt and only
 * changed / new / removed rows are written — instead of truncating the table on
 * every run. The whole thing is one transaction, so readers never see a partial
 * state. Cheap at this scale (≈1,600 rows), and runs daily via cron + on every
 * catalog/master mutation via the storefront revalidate hook.
 */
export async function refreshSearchKeywordIndex(): Promise<number> {
  const rows = await buildSearchKeywordRows();
  if (rows.length === 0) {
    // Defensive: an empty build (e.g. a transient read failure) must NOT wipe the
    // live index. Leave the existing rows untouched.
    return 0;
  }

  const runStartedAt = new Date();

  await db.$transaction(async (tx) => {
    // Bulk upsert every built row in a single statement. Touched rows (inserted or
    // updated) get updatedAt = runStartedAt; rows not present this run keep their
    // older updatedAt and are deleted below.
    await tx.$executeRaw(Prisma.sql`
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
    `);

    // Remove rows that no longer exist in the catalog (not touched this run).
    await tx.$executeRaw(Prisma.sql`
      DELETE FROM "SearchKeyword" WHERE "updatedAt" < ${runStartedAt}
    `);
  });

  return rows.length;
}

/**
 * Fire-and-forget index refresh for use inside Server Actions / route handlers
 * after a catalog or master-data mutation. Never awaited, never throws — a refresh
 * failure must not affect the business operation that triggered it. This is a
 * best-effort "make the dropdown fresh sooner"; the daily cron remains the
 * guaranteed catch-all (and on serverless a fire-and-forget may be cut off, which
 * is exactly why the cron exists).
 */
export function triggerSearchKeywordRefresh(): void {
  void refreshSearchKeywordIndex().catch((error) => {
    console.error("[search-keyword] background refresh failed", error);
  });
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
