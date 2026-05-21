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

const SYNONYM_CACHE_TAG = "search-synonyms";
const SYNONYM_CACHE_KEY = ["search-synonyms:active"];
const SYNONYM_CACHE_REVALIDATE = 300; // 5 minutes

/** Hard cap to prevent runaway expansion (Phase D Q2 = 10). Enforced at write time too. */
export const MAX_SYNONYMS_PER_TERM = 10;
/** Hard cap on tokens produced after expansion, so a single query never explodes. */
const MAX_EXPANDED_TOKENS = 32;

type SynonymRow = {
  term: string;
  synonyms: string[];
};

/**
 * Load active synonyms from DB. Cached for 5 minutes; revalidate via
 * `revalidateTag("search-synonyms")` after admin mutations.
 */
const loadActiveSynonyms = unstable_cache(
  async (): Promise<SynonymRow[]> => {
    return db.searchSynonym.findMany({
      where: { isActive: true },
      select: { term: true, synonyms: true },
    });
  },
  SYNONYM_CACHE_KEY,
  { tags: [SYNONYM_CACHE_TAG], revalidate: SYNONYM_CACHE_REVALIDATE },
);

/**
 * Build a bi-directional expansion map: every input token (term or synonym)
 * points to its full equivalence class (term + all synonyms).
 */
const buildExpansionMap = (rows: SynonymRow[]): Map<string, string[]> => {
  const map = new Map<string, string[]>();

  for (const row of rows) {
    const cluster = Array.from(
      new Set([row.term, ...row.synonyms].map((s) => s.trim().toLowerCase()).filter(Boolean)),
    );
    if (cluster.length === 0) continue;

    for (const key of cluster) {
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
  const normalized = rawQuery.trim().toLowerCase();
  if (!normalized) return [];

  const rows = await loadActiveSynonyms();
  if (rows.length === 0) return [normalized];

  const map = buildExpansionMap(rows);

  // Tokenize on whitespace AND keep the full query as a single token so
  // multi-word terms like "คอมแอร์วีออส" still match dictionary entries.
  const wordTokens = normalized.split(/\s+/).filter(Boolean);
  const candidates = new Set<string>([normalized, ...wordTokens]);

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

export const SEARCH_SYNONYM_CACHE_TAG = SYNONYM_CACHE_TAG;
