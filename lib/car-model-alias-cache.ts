/**
 * In-memory TTL cache for a DB-backed car-MODEL spelling lookup, mirroring
 * {@link getCachedCarBrandVariantLookup}. Model transliterations ("Strada" ↔
 * "สตาด้า") live in the `SearchSynonym` table (seeded by
 * prisma/scripts/seed-model-synonyms.ts), NOT in the hardcoded brand map — so the
 * LINE/Messenger search guard needs this to ground a model the customer typed in
 * Thai even though the classifier + master data use the English canonical name.
 *
 * Keeps the per-turn guard sync-friendly: the processor prefetches the built
 * lookup once (cheap, amortized) and passes it into the (sync) search guard.
 */

export type CarModelSynonymRow = {
  term: string;
  synonyms: string[];
};

/**
 * Lookup keyed by every accepted spelling (lowercased) → the full set of spellings
 * for that model cluster. So an English classifier value ("strada") OR a Thai
 * customer spelling ("สตาด้า") both resolve to the same variant list.
 */
export type CarModelVariantLookup = Map<string, string[]>;

export const CAR_MODEL_ALIAS_CACHE_TTL_MS = 60_000;

type CacheState = {
  expiresAt: number;
  lookup: CarModelVariantLookup;
};

let cacheState: CacheState | null = null;

export const invalidateCarModelAliasCache = () => {
  cacheState = null;
};

/** Builds the spelling→variants lookup from raw SearchSynonym rows. Pure + exported
 *  for tests. Every member of a cluster (term + synonyms) maps to the whole cluster,
 *  so a lookup by any spelling returns all accepted spellings. */
export const buildCarModelVariantLookup = (rows: CarModelSynonymRow[]): CarModelVariantLookup => {
  const lookup: CarModelVariantLookup = new Map();
  for (const row of rows) {
    const members = [row.term, ...(row.synonyms ?? [])]
      .map((value) => value?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value));
    if (members.length === 0) continue;
    const list = Array.from(new Set(members));
    for (const member of list) lookup.set(member, list);
  }
  return lookup;
};

export const getCachedCarModelVariantLookup = async (
  loadRows: () => Promise<CarModelSynonymRow[]>,
  options: { now?: () => number; ttlMs?: number } = {},
): Promise<CarModelVariantLookup> => {
  const now = options.now?.() ?? Date.now();
  const ttlMs = options.ttlMs ?? CAR_MODEL_ALIAS_CACHE_TTL_MS;

  if (cacheState && cacheState.expiresAt > now) {
    return cacheState.lookup;
  }

  const lookup = buildCarModelVariantLookup(await loadRows());
  cacheState = { lookup, expiresAt: now + ttlMs };
  return lookup;
};
