import {
  buildCarModelVariantLookup,
  type CarModelVariantLookup,
} from "@/lib/car-model-alias-cache";
import { loadActiveSynonymRows } from "@/lib/search-synonyms";

/**
 * Loads the model spelling→variants lookup for the LINE/Messenger search guard,
 * through the shared, tag-invalidated synonym cache. Best-effort: on any DB error it returns an empty
 * lookup so the guard transparently falls back to the previous (English-only)
 * evidence matching.
 */
export const loadCarModelVariantLookup = async (): Promise<CarModelVariantLookup> => {
  try {
    return buildCarModelVariantLookup(await loadActiveSynonymRows());
  } catch {
    return new Map();
  }
};
