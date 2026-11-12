/**
 * Phase D — Global search synonym dictionary.
 *
 * Loads SearchSynonym rows from DB, caches them, and exposes a bi-directional
 * `expandQueryTokens()` helper that augments user-typed tokens with all known
 * synonyms before the search engine builds its tsquery / fuzzy match clauses.
 *
 * Bi-directional: searching "compressor" expands to include
 * ["คอมแอร์", "คอมเพรสเซอร์"] when a SearchSynonym row contains
 * `term="คอมแอร์", synonyms=["compressor","คอมเพรสเซอร์"]`.
 */

import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma";
import { buildSearchVariants, normalizeSearchText, tokenizeSearchVariants } from "@/lib/search-normalization";

const SYNONYM_CACHE_TAG = "search-synonyms";
const SYNONYM_CACHE_KEY = ["search-synonyms:active"];
const SYNONYM_CACHE_REVALIDATE = 300; // 5 minutes

/**
 * Hard cap to prevent runaway expansion. Enforced at write time too (the admin
 * Server Action's Zod schema and the chip input mirror this value).
 *
 * Raised 10 → 15 → 18 on 2026-08-03. A LINE customer asked for "บล็อควาล์ว revo"
 * and saw only 1 of the 2 matching SKUs: the block-valve spellings Thai buyers
 * actually type were missing from the "วาล์วแอร์" cluster, which was already full
 * at 10/10 — so covering them would have meant deleting working synonyms. Auditing
 * two months of inbound LINE messages then turned up a second family the cluster
 * had to hold ("วาว์ล", the most-typed valve misspelling in the data), which is
 * what took it past 15.
 *
 * The cost of a wider cluster was measured against production before changing
 * this: the FTS clause is a GIN index scan, so growing a concept from 11 to 16
 * lexemes costs +0.03ms server-side (0.499 → 0.532ms), and +0.05ms in the worst
 * case of three max-size concepts at once — roughly 1/1000 of the network
 * round-trip to the database. Several clusters seeded by
 * scripts/import-car-search-synonyms.ts already hold 12-30 synonyms, so this
 * mostly unlocks data that was being truncated at read time rather than adding
 * new work.
 */
export const MAX_SYNONYMS_PER_TERM = 18;
/** Hard cap on tokens produced after expansion, so a single query never explodes. */
const MAX_EXPANDED_TOKENS = 32;

export type SynonymRow = {
  term: string;
  synonyms: string[];
};

/** Reads the active rows straight from the table (the query every path used before). */
const findActiveSynonymRows = (): Promise<SynonymRow[]> =>
  db.searchSynonym.findMany({
    where: { isActive: true },
    select: { term: true, synonyms: true },
  });

/**
 * Identity of the active row versions: every physical tuple (ctid) and the
 * transaction that wrote it (xmin). Postgres never changes a tuple in place —
 * any UPDATE (even to the same values), INSERT, DELETE or isActive toggle, by
 * the app, a script or raw SQL, replaces or removes a tuple — so an equal value
 * means the same tuples in the same heap order, i.e. the same rows in the same
 * order as findActiveSynonymRows(). One 32-character value instead of the table.
 */
const ACTIVE_SYNONYM_VERSION_SQL = Prisma.sql`
  SELECT md5(coalesce(string_agg(xmin::text || ':' || ctid::text, ',' ORDER BY ctid), ''))
  FROM "SearchSynonym"
  WHERE "isActive" = true
`;

type ActiveSynonymSnapshot = { version: string; rows: SynonymRow[] };

/** Per-instance copy of the last full read, re-used while the table is unchanged. */
let activeSynonymSnapshot: ActiveSynonymSnapshot | null = null;

const copySynonymRows = (rows: SynonymRow[]): SynonymRow[] =>
  rows.map((row) => ({ term: row.term, synonyms: [...row.synonyms] }));

const readActiveSynonymVersion = async (): Promise<string | null> => {
  const rows = await db.$queryRaw<Array<{ version: string | null }>>(
    Prisma.sql`SELECT (${ACTIVE_SYNONYM_VERSION_SQL}) AS "version"`,
  );
  return rows[0]?.version ?? null;
};

/**
 * The same rows, in the same (heap) order, as findActiveSynonymRows() — same table,
 * same filter, no ORDER BY — plus the version, taken by the same statement so both
 * come from one snapshot and the stored pair can never describe two table states.
 */
const readActiveSynonymSnapshot = async (): Promise<ActiveSynonymSnapshot | null> => {
  const rows = await db.$queryRaw<Array<SynonymRow & { version: string }>>(Prisma.sql`
    SELECT "term", "synonyms", (${ACTIVE_SYNONYM_VERSION_SQL}) AS "version"
    FROM "SearchSynonym"
    WHERE "isActive" = true
  `);
  if (rows.length === 0) return null;
  return { version: rows[0].version, rows: rows.map((row) => ({ term: row.term, synonyms: row.synonyms })) };
};

/**
 * Same result as {@link findActiveSynonymRows}, but a repeat read on this instance
 * costs a 1-row version check instead of the full table.
 *
 * Product search calls this from inside its own `unstable_cache`, where Next skips
 * reading the nested synonym cache and runs this every time (see
 * `node_modules/next/dist/server/web/spec-extension/unstable-cache.js`). Checking
 * the version on every call keeps that path exactly as fresh as the direct read it
 * replaces — no TTL, no extra staleness.
 */
const loadActiveSynonymsUncached = async (): Promise<SynonymRow[]> => {
  if (activeSynonymSnapshot) {
    const currentVersion = await readActiveSynonymVersion();
    if (currentVersion === activeSynonymSnapshot.version) {
      return copySynonymRows(activeSynonymSnapshot.rows);
    }
  }

  const snapshot = await readActiveSynonymSnapshot();
  activeSynonymSnapshot = snapshot ? { version: snapshot.version, rows: copySynonymRows(snapshot.rows) } : null;
  return snapshot?.rows ?? [];
};

/** Test seam: forget the per-instance snapshot. */
export const resetActiveSynonymSnapshotForTest = (): void => {
  activeSynonymSnapshot = null;
};

/**
 * Load active synonyms from DB. Cached for 5 minutes; revalidate via
 * `revalidateTag("search-synonyms")` after admin mutations.
 */
const loadActiveSynonyms = unstable_cache(
  loadActiveSynonymsUncached,
  SYNONYM_CACHE_KEY,
  { tags: [SYNONYM_CACHE_TAG], revalidate: SYNONYM_CACHE_REVALIDATE },
);

/** Shared active-row source for every search consumer, including chat guards. */
export const loadActiveSynonymRows = (options: { bypassCache?: boolean } = {}): Promise<SynonymRow[]> =>
  options.bypassCache ? findActiveSynonymRows() : loadActiveSynonyms();

/**
 * Build a bi-directional expansion map: every input token (term or synonym)
 * points to its full equivalence class (term + all synonyms).
 */
const buildExpansionMap = (rows: SynonymRow[]): Map<string, string[]> => {
  const map = new Map<string, string[]>();

  for (const row of rows) {
    const cluster = Array.from(
      new Set([row.term, ...row.synonyms].map((s) => normalizeSearchText(s)).filter(Boolean)),
    );
    if (cluster.length === 0) continue;

    const keys = new Set<string>();
    for (const item of cluster) {
      for (const variant of buildSearchVariants(item)) {
        keys.add(variant);
      }
    }

    for (const key of keys) {
      const existing = map.get(key);
      if (existing) {
        // Merge clusters — handles overlapping synonyms like "Vios" ↔ "วีออส" plus "vios" ↔ "v-ios"
        const merged = Array.from(new Set([...existing, ...cluster]));
        for (const k of merged) {
          map.set(k, merged);
        }
      } else {
        map.set(key, cluster);
      }
    }
  }

  return map;
};

/**
 * Expand a single user-typed token into the full set of synonymous tokens.
 * Returns the original token plus all known synonyms (lower-cased).
 */
export async function expandQueryTokens(rawQuery: string): Promise<string[]> {
  const normalized = normalizeSearchText(rawQuery);
  if (!normalized) return [];

  const rows = await loadActiveSynonymRows();
  if (rows.length === 0) return [normalized];

  const map = buildExpansionMap(rows);

  // Tokenize on whitespace AND keep the full query as a single token so
  // multi-word terms like "คอมแอร์วีออส" still match dictionary entries.
  const candidates = new Set<string>(tokenizeSearchVariants(normalized));

  const expanded = new Set<string>();
  for (const token of candidates) {
    expanded.add(token);
    const cluster = map.get(token);
    if (cluster) {
      for (const synonym of cluster) {
        expanded.add(synonym);
        if (expanded.size >= MAX_EXPANDED_TOKENS) return Array.from(expanded);
      }
    }
  }

  return Array.from(expanded);
}

/**
 * Group-aware expansion for AND-across-concepts search. Splits the query into its
 * whitespace "concepts" (each typed word) and returns, per concept, that word plus
 * its synonym cluster. The search layer then builds an AND across groups and an OR
 * within each group's synonyms — e.g. "หม้อน้ำ mazda 2" →
 * [["หม้อน้ำ","radiator",...], ["mazda","มาสด้า"], ["2"]] → (หม้อน้ำ|…) & (mazda|…) & (2)
 * so a product must match every concept, not just any one of them.
 *
 * (`expandQueryTokens` stays as the flat OR-recall fallback used when the strict
 * AND query returns nothing.)
 */
export async function expandQueryTokenGroups(
  rawQuery: string,
  options: { bypassCache?: boolean } = {},
): Promise<string[][]> {
  const normalized = normalizeSearchText(rawQuery);
  if (!normalized) return [];

  const conceptTokens = normalized.split(/\s+/).filter(Boolean);
  if (conceptTokens.length === 0) return [];

  const rows = await loadActiveSynonymRows({ bypassCache: options.bypassCache });
  const map = rows.length > 0 ? buildExpansionMap(rows) : null;

  const groups: string[][] = [];
  for (const token of conceptTokens) {
    const cluster = new Set<string>([token]);
    if (map) {
      for (const variant of buildSearchVariants(token)) {
        const hit = map.get(variant);
        if (hit) {
          for (const synonym of hit) {
            const normalizedSynonym = normalizeSearchText(synonym);
            if (normalizedSynonym) cluster.add(normalizedSynonym);
            if (cluster.size >= MAX_SYNONYMS_PER_TERM + 1) break;
          }
        }
      }
    }
    groups.push(Array.from(cluster));
  }

  return groups;
}

export const SEARCH_SYNONYM_CACHE_TAG = SYNONYM_CACHE_TAG;
