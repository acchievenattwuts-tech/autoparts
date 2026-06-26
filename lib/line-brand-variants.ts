/**
 * Thai↔English car-brand name variants for LINE customer-evidence matching.
 *
 * The AI classifier and master data (`CarBrand.name`) are English ("Toyota"),
 * but customers usually type the brand in Thai ("โตโยต้า"). The evidence guard
 * ({@link lineValueHasCustomerEvidence}) checks whether the customer actually
 * mentioned a value before it is allowed to become a hard search filter — and a
 * naive substring check can't bridge "Toyota" ↔ "โตโยต้า", so a clearly-stated
 * brand gets dropped and the search is no longer brand-scoped.
 *
 * This maps each canonical (lowercased English) brand to every spelling we accept
 * as evidence. Keys cover every active row in the `CarBrand` master table.
 *
 * NOTE: scope is BRAND only. Thai model-name aliases (e.g. "ยาริส"→"Yaris") are a
 * separate, larger surface and are intentionally not handled here. The English
 * brand/model term list in `lib/line-fitment-extract.ts` (CAR_KEYWORD_RE) is a
 * sibling source of truth for query enrichment — keep both in sync when adding a
 * brand.
 */

const BRAND_VARIANTS: Record<string, string[]> = {
  toyota: ["toyota", "โตโยต้า", "โตโยตา"],
  nissan: ["nissan", "นิสสัน"],
  honda: ["honda", "ฮอนด้า", "ฮอนดา"],
  mazda: ["mazda", "มาสด้า"],
  mitsubishi: ["mitsubishi", "มิตซูบิชิ", "มิตซู"],
  isuzu: ["isuzu", "อีซูซุ", "อีซุซุ"],
  suzuki: ["suzuki", "ซูซูกิ"],
  ford: ["ford", "ฟอร์ด"],
  chevrolet: ["chevrolet", "เชฟโรเลต", "เชฟ"],
  hyundai: ["hyundai", "ฮุนได", "ฮุนไดย์"],
  lexus: ["lexus", "เล็กซัส"],
  hino: ["hino", "ฮีโน่", "ฮีโน"],
  mg: ["mg", "เอ็มจี"],
  ud: ["ud"],
  roewe: ["roewe"],
};

const VARIANT_TO_KEY: Record<string, string> = {};
for (const [key, variants] of Object.entries(BRAND_VARIANTS)) {
  for (const v of variants) VARIANT_TO_KEY[v.trim().toLowerCase()] = key;
}

/**
 * All known spellings (Thai + English) of a brand, for evidence matching. Accepts
 * either an English canonical name or a Thai spelling. Unknown brands (not in the
 * master mapping) pass through as a single lowercased token, so behaviour is never
 * worse than before for an unmapped value.
 *
 *  getBrandVariants("Toyota")  → ["toyota", "โตโยต้า", "โตโยตา"]
 *  getBrandVariants("โตโยต้า") → ["toyota", "โตโยต้า", "โตโยตา"]
 *  getBrandVariants("tesla")   → ["tesla"]
 */
export function getBrandVariants(brandName: string | null | undefined): string[] {
  if (!brandName) return [];
  const lower = brandName.trim().toLowerCase();
  if (!lower) return [];
  const key = VARIANT_TO_KEY[lower];
  if (!key) return [lower];
  return Array.from(new Set(BRAND_VARIANTS[key]?.map((v) => v.trim().toLowerCase()) ?? [lower]));
}

/**
 * Resolves all accepted spellings of a brand, preferring the DB-backed lookup
 * (admin-editable) and unioning the hardcoded {@link getBrandVariants} map as a
 * safety fallback — so evidence matching keeps working even before the alias
 * table is seeded or if the DB load fails. `dbLookup` is keyed by every spelling
 * (lowercased) → the brand's full variant list.
 */
export function resolveBrandVariants(
  brandName: string | null | undefined,
  dbLookup?: ReadonlyMap<string, string[]> | null,
): string[] {
  const fallback = getBrandVariants(brandName);
  if (!brandName || !dbLookup) return fallback;
  const fromDb = dbLookup.get(brandName.trim().toLowerCase());
  if (!fromDb || fromDb.length === 0) return fallback;
  return Array.from(new Set([...fallback, ...fromDb]));
}
