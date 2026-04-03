export const slugifySegment = (value: string): string => {
  const normalized = value
    .normalize("NFC")
    .toLowerCase()
    .trim()
    .replace(/['’]+/g, "")
    .replace(/[^\p{Letter}\p{Number}\p{Mark}]+/gu, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "item";
};

const legacySlugifySegment = (value: string): string => {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "item";
};

type CategorySlugInput =
  | string
  | {
      name: string;
      slug?: string | null;
    };

type ProductSlugInput =
  | {
      productName: string;
      productId: string;
      productSlug?: string | null;
    }
  | {
      name: string;
      id: string;
      slug?: string | null;
    };

const getCategoryName = (input: CategorySlugInput): string =>
  typeof input === "string" ? input : input.name;

const getCategoryStoredSlug = (input: CategorySlugInput): string | null =>
  typeof input === "string" ? null : input.slug ?? null;

const getProductName = (input: ProductSlugInput): string =>
  "productName" in input ? input.productName : input.name;

const getProductId = (input: ProductSlugInput): string =>
  "productId" in input ? input.productId : input.id;

const getProductStoredSlug = (input: ProductSlugInput): string | null =>
  "productSlug" in input
    ? input.productSlug ?? null
    : "slug" in input
      ? input.slug ?? null
      : null;

export const getProductCategorySlug = (category: CategorySlugInput): string => {
  return getCategoryStoredSlug(category) ?? slugifySegment(getCategoryName(category));
};

type LegacyCategorySlugRecord = {
  id: string;
  name: string;
  createdAt: Date | string;
};

const getSortableTime = (value: Date | string) => {
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
};

const buildUniqueLegacySlug = (value: string, taken: Set<string>) => {
  const base = legacySlugifySegment(value);

  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }

  let suffix = 2;
  while (true) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
    suffix += 1;
  }
};

export const buildLegacyCategorySlugMap = (
  categories: readonly LegacyCategorySlugRecord[],
): Map<string, string> => {
  const taken = new Set<string>();
  const sortedCategories = [...categories].sort((left, right) => {
    const createdAtDiff = getSortableTime(left.createdAt) - getSortableTime(right.createdAt);
    if (createdAtDiff !== 0) {
      return createdAtDiff;
    }

    return left.id.localeCompare(right.id);
  });

  return new Map(
    sortedCategories.map((category) => [
      buildUniqueLegacySlug(category.name, taken),
      category.id,
    ]),
  );
};

export const isPlaceholderSlug = (slug: string | null | undefined): boolean => {
  if (!slug) {
    return false;
  }

  return /^(?:item|category|product)(?:-\d+)?$/.test(slug);
};

export const getCategoryPath = (category: CategorySlugInput): string => {
  return `/products/${getProductCategorySlug(category)}`;
};

export const getProductSlug = (product: ProductSlugInput): string => {
  const slug = getProductStoredSlug(product) ?? slugifySegment(getProductName(product));
  return `${slug}-${getProductId(product)}`;
};

export const getProductPath = ({
  category,
  product,
}: {
  category: CategorySlugInput;
  product: ProductSlugInput;
}): string => {
  return `/products/${getProductCategorySlug(category)}/${getProductSlug(product)}`;
};

export const extractProductIdFromSlug = (slug: string): string | null => {
  const index = slug.lastIndexOf("-");
  if (index === -1) {
    return null;
  }

  const id = slug.slice(index + 1).trim();
  return id || null;
};
