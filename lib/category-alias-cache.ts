import type { CategoryAliasResolverRow } from "@/lib/category-alias-resolver";

export const CATEGORY_ALIAS_CACHE_TTL_MS = 60_000;

type CacheState = {
  expiresAt: number;
  rows: CategoryAliasResolverRow[];
};

let cacheState: CacheState | null = null;

export const invalidateCategoryAliasCache = () => {
  cacheState = null;
};

export const getCachedCategoryAliasRows = async (
  loadRows: () => Promise<CategoryAliasResolverRow[]>,
  options: { now?: () => number; ttlMs?: number } = {},
): Promise<CategoryAliasResolverRow[]> => {
  const now = options.now?.() ?? Date.now();
  const ttlMs = options.ttlMs ?? CATEGORY_ALIAS_CACHE_TTL_MS;

  if (cacheState && cacheState.expiresAt > now) {
    return cacheState.rows;
  }

  const rows = await loadRows();
  cacheState = {
    rows,
    expiresAt: now + ttlMs,
  };
  return rows;
};
