import { db } from "@/lib/db";
import {
  getCachedCarBrandVariantLookup,
  type CarBrandVariantLookup,
} from "@/lib/car-brand-alias-cache";

/**
 * Loads the brand spelling→variants lookup for the LINE search guard, through the
 * in-memory TTL cache. Best-effort: on any DB error it returns an empty lookup so
 * the guard transparently falls back to the hardcoded brand map.
 */
export const loadCarBrandVariantLookup = async (): Promise<CarBrandVariantLookup> => {
  try {
    return await getCachedCarBrandVariantLookup(() =>
      db.carBrandAlias.findMany({
        where: { isActive: true, carBrand: { isActive: true } },
        select: {
          alias: true,
          isActive: true,
          carBrand: { select: { name: true, isActive: true } },
        },
      }),
    );
  } catch {
    return new Map();
  }
};
