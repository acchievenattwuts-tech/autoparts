/**
 * In-memory TTL cache for the DB-backed car-brand alias lookup, mirroring
 * {@link getCachedCategoryAliasRows}. Keeps the per-turn LINE guard sync-friendly:
 * the processor prefetches the built lookup once (cheap, amortized) and passes it
 * into the (sync) search guard.
 */

export type CarBrandAliasRow = {
  alias: string;
  isActive: boolean;
  carBrand: { name: string; isActive: boolean };
};

/**
 * Lookup keyed by every accepted spelling (lowercased) → the full set of
 * spellings for that brand. So an English classifier value ("toyota") OR a Thai
 * customer spelling ("โตโยต้า") both resolve to the same variant list.
 */
export type CarBrandVariantLookup = Map<string, string[]>;

export const CAR_BRAND_ALIAS_CACHE_TTL_MS = 60_000;

type CacheState = {
  expiresAt: number;
  lookup: CarBrandVariantLookup;
};

let cacheState: CacheState | null = null;

export const invalidateCarBrandAliasCache = () => {
  cacheState = null;
};

/** Builds the spelling→variants lookup from raw rows. Pure + exported for tests. */
export const buildCarBrandVariantLookup = (rows: CarBrandAliasRow[]): CarBrandVariantLookup => {
  // Group accepted spellings per active brand (brand canonical name + its aliases).
  const byBrand = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.isActive || !row.carBrand.isActive) continue;
    const brandKey = row.carBrand.name.trim().toLowerCase();
    if (!brandKey) continue;
    const set = byBrand.get(brandKey) ?? new Set<string>([brandKey]);
    const alias = row.alias.trim().toLowerCase();
    if (alias) set.add(alias);
    byBrand.set(brandKey, set);
  }

  const lookup: CarBrandVariantLookup = new Map();
  for (const variants of byBrand.values()) {
    const list = Array.from(variants);
    for (const variant of list) lookup.set(variant, list);
  }
  return lookup;
};

export const getCachedCarBrandVariantLookup = async (
  loadRows: () => Promise<CarBrandAliasRow[]>,
  options: { now?: () => number; ttlMs?: number } = {},
): Promise<CarBrandVariantLookup> => {
  const now = options.now?.() ?? Date.now();
  const ttlMs = options.ttlMs ?? CAR_BRAND_ALIAS_CACHE_TTL_MS;

  if (cacheState && cacheState.expiresAt > now) {
    return cacheState.lookup;
  }

  const lookup = buildCarBrandVariantLookup(await loadRows());
  cacheState = { lookup, expiresAt: now + ttlMs };
  return lookup;
};
