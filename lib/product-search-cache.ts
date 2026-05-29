import { revalidateTag, updateTag } from "next/cache";

export const PRODUCT_SEARCH_TAG = "product-search";
export const ADMIN_PRODUCT_SEARCH_CACHE_TTL_SECONDS = 60;
export const STOREFRONT_PRODUCT_SEARCH_CACHE_TTL_SECONDS = 300;

export type ProductSearchCacheProfile = "admin" | "storefront";

export const getProductSearchCacheTtl = (
  profile: ProductSearchCacheProfile = "storefront",
): number =>
  profile === "admin"
    ? ADMIN_PRODUCT_SEARCH_CACHE_TTL_SECONDS
    : STOREFRONT_PRODUCT_SEARCH_CACHE_TTL_SECONDS;

export const revalidateProductSearchCache = () => {
  revalidateTag(PRODUCT_SEARCH_TAG, "max");
};

export const updateProductSearchCache = () => {
  updateTag(PRODUCT_SEARCH_TAG);
};
