import { unstable_cache } from "next/cache";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import {
  buildLegacyCategorySlugMap,
  extractCategoryIdFromSlug,
  getProductCategorySlug,
  normalizeSlugSegment,
} from "./product-slug";

const CATEGORY_CACHE_TAGS = ["storefront:categories"];

const fetchActiveCategoryById = async (categoryId: string) =>
  unstable_cache(
    async () =>
      db.category.findFirst({
        where: {
          id: categoryId,
          isActive: true,
        },
        select: { id: true, name: true, slug: true, createdAt: true },
      }),
    [`storefront-category:${categoryId}`],
    { tags: [...CATEGORY_CACHE_TAGS, `storefront-category:${categoryId}`] },
  )();

const fetchActiveCategories = unstable_cache(
  async () =>
    db.category.findMany({
      where: { isActive: true },
      select: { id: true, name: true, slug: true, createdAt: true },
      orderBy: { name: "asc" },
    }),
  ["storefront-active-categories"],
  { tags: CATEGORY_CACHE_TAGS },
);

export const getActiveStorefrontCategoryBySlug = async (categorySlug: string) => {
  const decodedCategorySlug = decodeURIComponent(categorySlug);
  const normalizedCategorySlug = normalizeSlugSegment(categorySlug);
  const decodedSlug = normalizeSlugSegment(decodedCategorySlug);
  const categoryId = extractCategoryIdFromSlug(decodedCategorySlug);
  const categoryFromId = categoryId ? await fetchActiveCategoryById(categoryId) : null;

  if (categoryFromId) {
    return categoryFromId;
  }

  const categories = await fetchActiveCategories();
  const legacyCategorySlugMap = buildLegacyCategorySlugMap(categories);
  const legacyCategoryId =
    legacyCategorySlugMap.get(categorySlug) ??
    legacyCategorySlugMap.get(normalizedCategorySlug);
  const category =
    categories.find((item) => item.slug && normalizeSlugSegment(item.slug) === normalizedCategorySlug) ??
    categories.find((item) => normalizeSlugSegment(item.name) === decodedSlug) ??
    categories.find((item) => item.id === legacyCategoryId) ??
    categories.find((item) => getProductCategorySlug(item) === normalizedCategorySlug);
  if (!category) {
    notFound();
  }

  return category;
};

const fetchCategoryProducts = unstable_cache(
  async (categoryId: string) =>
    db.product.findMany({
      where: {
        isActive: true,
        categoryId,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        code: true,
        imageUrl: true,
        salePrice: true,
        stock: true,
        reportUnitName: true,
        category: { select: { id: true, name: true, slug: true } },
        brand: { select: { name: true } },
        carModels: {
          select: {
            carModel: {
              select: {
                name: true,
                carBrand: { select: { name: true } },
              },
            },
          },
          take: 6,
        },
      },
      orderBy: [{ stock: "desc" }, { createdAt: "desc" }],
      take: 8,
    }),
  ["storefront-category-products"],
  { tags: [...CATEGORY_CACHE_TAGS, "storefront:products"] },
);

export async function getStorefrontCategoryPageData(categorySlug: string) {
  const category = await getActiveStorefrontCategoryBySlug(categorySlug);
  const products = await fetchCategoryProducts(category.id);
  return { category, products };
}
