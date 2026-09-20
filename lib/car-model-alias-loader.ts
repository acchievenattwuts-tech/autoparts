import {
  buildCarModelGroundingLookup,
  buildCarModelVariantLookup,
  scopeSynonymRowsToCarModels,
  type CarModelGroundingLookup,
  type CarModelVariantLookup,
} from "@/lib/car-model-alias-cache";
import { loadActiveSynonymRows } from "@/lib/search-synonyms";
import { db } from "@/lib/db";

let scopedRowsCache: {
  expiresAt: number;
  rows: Awaited<ReturnType<typeof loadActiveSynonymRows>>;
} | null = null;

const loadActiveCarModelSynonymRows = async () => {
  const now = Date.now();
  if (scopedRowsCache && scopedRowsCache.expiresAt > now) return scopedRowsCache.rows;

  const [rows, models] = await Promise.all([
    loadActiveSynonymRows(),
    db.carModel.findMany({ where: { isActive: true }, select: { name: true } }),
  ]);
  const scoped = scopeSynonymRowsToCarModels(rows, models.map((model) => model.name));
  scopedRowsCache = { expiresAt: now + 60_000, rows: scoped };
  return scoped;
};

/**
 * Loads the model spelling→variants lookup for the LINE/Messenger search guard,
 * through the shared, tag-invalidated synonym cache. Best-effort: on any DB error it returns an empty
 * lookup so the guard transparently falls back to the previous (English-only)
 * evidence matching.
 */
export const loadCarModelVariantLookup = async (): Promise<CarModelVariantLookup> => {
  try {
    return buildCarModelVariantLookup(await loadActiveCarModelSynonymRows());
  } catch {
    return new Map();
  }
};

/** Shadow-only hard-grounding evidence. Kept separate from the broad recall map. */
export const loadCarModelGroundingLookup = async (): Promise<CarModelGroundingLookup> => {
  try {
    return buildCarModelGroundingLookup(await loadActiveCarModelSynonymRows());
  } catch {
    return new Map();
  }
};
