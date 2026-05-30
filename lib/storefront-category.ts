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

const PAGE_SIZE = 20;

const fetchCategoryProductPage = unstable_cache(
  async (categoryId: string, page: number) => {
    const skip = (page - 1) * PAGE_SIZE;
    const where = { isActive: true, categoryId } as const;
    const [products, total] = await Promise.all([
      db.product.findMany({
        where,
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
            where: { fitmentType: "DIRECT" },
            select: {
              yearStart: true,
              yearEnd: true,
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
        skip,
        take: PAGE_SIZE,
      }),
      db.product.count({ where }),
    ]);
    // Serialize Decimal → string so the result can be passed from Server Component
    // to Client Component (Next.js 16 forbids Decimal across the boundary).
    const serialized = products.map((p) => ({
      ...p,
      salePrice: p.salePrice.toString(),
    }));
    return { products: serialized, total };
  },
  ["storefront-category-products"],
  { tags: [...CATEGORY_CACHE_TAGS, "storefront:products"] },
);

export async function getStorefrontCategoryPageData(categorySlug: string, page: number = 1) {
  const category = await getActiveStorefrontCategoryBySlug(categorySlug);
  const safePage = Math.max(1, page);
  const { products, total } = await fetchCategoryProductPage(category.id, safePage);
  return { category, products, total, page: safePage, pageSize: PAGE_SIZE };
}
