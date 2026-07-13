import {
  getAdminActiveBadgeTone,
  getAdminMasterRowClass,
} from "@/lib/admin-status-presentation";
import { cn } from "@/lib/utils";

type ProductSearchBadgeTone = "success" | "danger";

export type ProductSearchOptionLike = {
  code: string;
  name: string;
  description?: string | null;
  categoryName: string;
  brandName?: string | null;
  aliases?: string[];
  aliasSearchText?: string;
  isActive?: boolean;
};

export function filterProductSearchOptions<T extends ProductSearchOptionLike>(
  products: T[],
  query: string,
  maxResults: number,
): T[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];

  return products
    .filter((product) => {
      return (
        product.code.toLowerCase().includes(normalizedQuery) ||
        product.name.toLowerCase().includes(normalizedQuery) ||
        (product.description?.toLowerCase().includes(normalizedQuery) ?? false) ||
        (product.brandName?.toLowerCase().includes(normalizedQuery) ?? false) ||
        product.categoryName.toLowerCase().includes(normalizedQuery) ||
        (product.aliasSearchText?.includes(normalizedQuery) ?? false) ||
        (product.aliases?.some((alias) => alias.toLowerCase().includes(normalizedQuery)) ?? false)
      );
    })
    .slice(0, maxResults);
}

/**
 * Compact, pre-normalized equivalent of aliases.some(alias => alias includes query).
 * A newline prevents a match from spanning two adjacent aliases; the product
 * picker is a single-line input, so users cannot submit that delimiter. Duplicate
 * aliases are irrelevant to `.some()` and are removed case-insensitively.
 */
export function buildProductAliasSearchText(aliases: readonly string[]): string {
  return [...new Set(aliases.map((alias) => alias.toLowerCase()))].join("\n");
}

export function getProductSearchOptionState(
  product: ProductSearchOptionLike,
  selected: boolean,
): {
  disabled: boolean;
  badgeLabel: string;
  badgeTone: ProductSearchBadgeTone;
  rowClassName: string;
  primaryTextClassName: string;
  secondaryTextClassName: string;
  codeTextClassName: string;
} {
  const isActive = product.isActive !== false;
  return {
    disabled: !isActive,
    badgeLabel: isActive ? "ใช้งาน" : "ปิดใช้งาน",
    badgeTone: getAdminActiveBadgeTone(isActive),
    rowClassName: cn(
      getAdminMasterRowClass(isActive),
      selected ? "ring-1 ring-inset ring-sky-300/70 dark:ring-sky-400/40" : null,
      !isActive ? "cursor-not-allowed opacity-85" : null,
    ),
    primaryTextClassName: isActive ? "" : "text-rose-900 dark:text-rose-50",
    secondaryTextClassName: isActive ? "" : "text-rose-700 dark:text-rose-100/90",
    codeTextClassName: isActive ? "" : "text-rose-700 dark:text-rose-200",
  };
}
