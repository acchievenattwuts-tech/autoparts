import { searchProductIds } from "@/lib/product-search";
import { extractProductSearchRequiredTokens } from "@/lib/product-search-required-tokens";
import { normalizeShelfRackCode } from "@/lib/shelf-location-rules";

/**
 * One filter set for the shelf map page, its Excel export and (phase 1b) the put-away page,
 * carried in the URL so an export always matches what is on screen.
 *
 * `q` uses the same search engine as the mobile product search (code, name, car model,
 * misspellings), so "คอยล์เย็น vigo" works the way the shop talks.
 */

export const SHELF_FILTER_SEARCH_MAX_LENGTH = 100;
/** Upper bound on matched products; the shop carries ~1,200, so this never truncates in practice. */
export const SHELF_FILTER_MAX_PRODUCTS = 5_000;

export type ShelfLocationStatusFilter = "all" | "located" | "unlocated";

export type ShelfMapFilters = {
  q: string;
  categoryIds: string[];
  brandId: string;
  carBrandId: string;
  rackCode: string;
  level: number | null;
  location: ShelfLocationStatusFilter;
  primaryOnly: boolean;
  inStockOnly: boolean;
};

type SearchParamValue = string | string[] | undefined;
export type ShelfSearchParams = Record<string, SearchParamValue>;

const first = (value: SearchParamValue): string => (Array.isArray(value) ? (value[0] ?? "") : (value ?? "")).trim();
const all = (value: SearchParamValue): string[] =>
  (Array.isArray(value) ? value : value ? [value] : [])
    .flatMap((item) => item.split(","))
    .map((item) => item.trim())
    .filter((item) => /^[a-z0-9]{1,50}$/.test(item));

export const parseShelfMapFilters = (params: ShelfSearchParams): ShelfMapFilters => {
  const location = first(params.location);
  const levelValue = Number.parseInt(first(params.level), 10);
  const rackCode = normalizeShelfRackCode(first(params.rack));
  return {
    q: first(params.q).slice(0, SHELF_FILTER_SEARCH_MAX_LENGTH),
    categoryIds: all(params.categoryId),
    brandId: all(params.brandId)[0] ?? "",
    carBrandId: all(params.carBrandId)[0] ?? "",
    rackCode: /^[A-Z0-9]{1,4}$/.test(rackCode) ? rackCode : "",
    level: Number.isInteger(levelValue) && levelValue >= 1 && levelValue <= 99 ? levelValue : null,
    location: location === "located" || location === "unlocated" ? location : "all",
    primaryOnly: first(params.primaryOnly) === "1",
    inStockOnly: first(params.inStock) !== "0",
  };
};

/** Query string for links that keep the current filters (export, rack/level drill-down). */
export const buildShelfMapFilterQuery = (filters: ShelfMapFilters, overrides: Partial<ShelfMapFilters> = {}): string => {
  const merged = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (merged.q) params.set("q", merged.q);
  for (const id of merged.categoryIds) params.append("categoryId", id);
  if (merged.brandId) params.set("brandId", merged.brandId);
  if (merged.carBrandId) params.set("carBrandId", merged.carBrandId);
  if (merged.rackCode) params.set("rack", merged.rackCode);
  if (merged.level !== null) params.set("level", String(merged.level));
  if (merged.location !== "all") params.set("location", merged.location);
  if (merged.primaryOnly) params.set("primaryOnly", "1");
  if (!merged.inStockOnly) params.set("inStock", "0");
  return params.toString();
};

export const hasProductFilters = (filters: ShelfMapFilters): boolean =>
  Boolean(filters.q || filters.categoryIds.length > 0 || filters.brandId || filters.carBrandId);

/**
 * Product ids matching the product-level filters (search, category, parts brand, car brand),
 * or null when none is set, meaning "every active product". Location filters are applied by
 * the caller's own query.
 */
export const resolveShelfFilterProductIds = async (filters: ShelfMapFilters): Promise<string[] | null> => {
  if (!hasProductFilters(filters)) return null;
  const requiredTokens = extractProductSearchRequiredTokens(filters.q);
  const result = await searchProductIds({
    query: filters.q || null,
    categoryIds: filters.categoryIds.length > 0 ? filters.categoryIds : null,
    brandId: filters.brandId || null,
    carBrandId: filters.carBrandId || null,
    isActive: true,
    skip: 0,
    take: SHELF_FILTER_MAX_PRODUCTS,
    cacheProfile: "admin",
    ...(requiredTokens.length > 0 ? { requiredTokens } : {}),
  });
  return result.ids;
};

/** Short Thai description of the active filters, for export headers. */
export const describeShelfMapFilters = (
  filters: ShelfMapFilters,
  names: { categories: Map<string, string>; partsBrands: Map<string, string>; carBrands: Map<string, string> },
): string => {
  const parts: string[] = [];
  if (filters.q) parts.push(`ค้นหา "${filters.q}"`);
  if (filters.categoryIds.length > 0) {
    parts.push(`หมวด ${filters.categoryIds.map((id) => names.categories.get(id) ?? id).join(", ")}`);
  }
  if (filters.brandId) parts.push(`แบรนด์ ${names.partsBrands.get(filters.brandId) ?? filters.brandId}`);
  if (filters.carBrandId) parts.push(`ยี่ห้อรถ ${names.carBrands.get(filters.carBrandId) ?? filters.carBrandId}`);
  if (filters.rackCode) parts.push(`ชั้นวาง ${filters.rackCode}${filters.level !== null ? ` ชั้น ${filters.level}` : ""}`);
  if (filters.location === "located") parts.push("เฉพาะที่มีตำแหน่ง");
  if (filters.location === "unlocated") parts.push("เฉพาะที่ยังไม่มีตำแหน่ง");
  if (filters.primaryOnly) parts.push("เฉพาะที่เก็บประจำ");
  if (filters.inStockOnly) parts.push("คงเหลือ > 0");
  return parts.length > 0 ? parts.join(" · ") : "ทุกสินค้า";
};
