export const slugifySegment = (value: string): string => {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "item";
};

export const getProductCategorySlug = (categoryName: string): string => {
  return slugifySegment(categoryName);
};

export const getCategoryPath = (categoryName: string): string => {
  return `/products/${encodeURIComponent(categoryName)}`;
};

export const getProductSlug = (productName: string, productId: string): string => {
  return `${slugifySegment(productName)}-${productId}`;
};

export const getProductPath = ({
  categoryName,
  productName,
  productId,
}: {
  categoryName: string;
  productName: string;
  productId: string;
}): string => {
  return `/products/${getProductCategorySlug(categoryName)}/${getProductSlug(
    productName,
    productId,
  )}`;
};

export const extractProductIdFromSlug = (slug: string): string | null => {
  const index = slug.lastIndexOf("-");
  if (index === -1) {
    return null;
  }

  const id = slug.slice(index + 1).trim();
  return id || null;
};
