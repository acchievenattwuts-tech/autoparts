import { db } from "@/lib/db";
import {
  getCachedCarModelVariantLookup,
  type CarModelVariantLookup,
} from "@/lib/car-model-alias-cache";

/**
 * Loads the model spelling→variants lookup for the LINE/Messenger search guard,
 * through the in-memory TTL cache. Best-effort: on any DB error it returns an empty
 * lookup so the guard transparently falls back to the previous (English-only)
 * evidence matching.
 */
export const loadCarModelVariantLookup = async (): Promise<CarModelVariantLookup> => {
  try {
    return await getCachedCarModelVariantLookup(() =>
      db.searchSynonym.findMany({
        where: { isActive: true },
        select: { term: true, synonyms: true },
      }),
    );
  } catch {
    return new Map();
  }
};
