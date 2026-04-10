import { revalidatePath, revalidateTag, updateTag } from "next/cache";

const STOREFRONT_TAGS = [
  "storefront:categories",
  "storefront:products",
  "storefront-product-filters",
  "product-search",
] as const;

const STOREFRONT_PATHS = ["/", "/products", "/sitemap.xml"] as const;

export const revalidateStorefrontPaths = () => {
  STOREFRONT_PATHS.forEach((path) => {
    revalidatePath(path);
  });
};

export const updateStorefrontTags = () => {
  STOREFRONT_TAGS.forEach((tag) => {
    updateTag(tag);
  });
};

export const revalidateStorefrontTags = () => {
  STOREFRONT_TAGS.forEach((tag) => {
    revalidateTag(tag, "max");
  });
};

export const refreshCategoryStorefrontCaches = async (categoryId?: string) => {
  updateStorefrontTags();
  revalidateStorefrontPaths();

  if (!categoryId) {
    return;
  }

  updateTag(`storefront-category:${categoryId}`);
};

export const revalidateStorefrontCaches = async (categoryId?: string) => {
  revalidateStorefrontTags();
  revalidateStorefrontPaths();

  if (!categoryId) {
    return;
  }

  revalidateTag(`storefront-category:${categoryId}`, "max");
};
