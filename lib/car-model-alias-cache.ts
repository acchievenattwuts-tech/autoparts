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

export type CarModelGroundingEvidence = {
  /** Display-preserving canonical term used to normalize conservative LLM prefixes. */
  canonicalTerm: string;
  /** Spellings that identify only this canonical SearchSynonym cluster. */
  safeVariants: string[];
  /** Spellings shared by two or more canonical clusters; never hard-ground on them. */
  ambiguousVariants: string[];
};

/**
 * A deliberately narrower lookup for hard-filter evidence. Product-search recall
 * may use broad/overlapping synonyms, but grounding must not: a spelling such as
 * "hiace" can belong to both Hiace and Hiace Commuter, so it is useful recall yet
 * unsafe proof for choosing one model.
 */
export type CarModelGroundingLookup = Map<string, CarModelGroundingEvidence>;

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

const normalizedMembers = (row: CarModelSynonymRow): string[] =>
  Array.from(
    new Set(
      [row.term, ...(row.synonyms ?? [])]
        .map((value) => value?.trim().toLowerCase())
        .filter((value): value is string => Boolean(value)),
    ),
  );

/**
 * Builds a shadow-only evidence lookup. Case-only duplicate canonical clusters are
 * merged first (MIRAGE/Mirage), then spellings owned by multiple different
 * canonical terms are marked ambiguous and excluded from `safeVariants`.
 */
export const buildCarModelGroundingLookup = (
  rows: CarModelSynonymRow[],
): CarModelGroundingLookup => {
  const clusters = new Map<string, { canonicalTerm: string; members: Set<string> }>();
  for (const row of rows) {
    const canonical = row.term.trim().toLowerCase();
    if (!canonical) continue;
    const cluster = clusters.get(canonical) ?? {
      canonicalTerm: row.term.trim(),
      members: new Set<string>(),
    };
    for (const member of normalizedMembers(row)) cluster.members.add(member);
    clusters.set(canonical, cluster);
  }

  const owners = new Map<string, Set<string>>();
  for (const [canonical, cluster] of clusters) {
    for (const member of cluster.members) {
      const memberOwners = owners.get(member) ?? new Set<string>();
      memberOwners.add(canonical);
      owners.set(member, memberOwners);
    }
  }

  const lookup: CarModelGroundingLookup = new Map();
  for (const [canonical, cluster] of clusters) {
    const safeVariants: string[] = [];
    const ambiguousVariants: string[] = [];
    for (const member of cluster.members) {
      if ((owners.get(member)?.size ?? 0) === 1) safeVariants.push(member);
      else ambiguousVariants.push(member);
    }
    lookup.set(canonical, { canonicalTerm: cluster.canonicalTerm, safeVariants, ambiguousVariants });
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
