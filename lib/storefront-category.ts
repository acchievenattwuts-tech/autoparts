import { unstable_cache } from "next/cache";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import {
  buildLegacyCategorySlugMap,
  getProductCategorySlug,
  normalizeSlugSegment,
} from "./product-slug";

export const getActiveStorefrontCategoryBySlug = async (categorySlug: string) => {
  const categories = await unstable_cache(
    async () =>
      db.category.findMany({
        where: { isActive: true },
        select: { id: true, name: true, slug: true, createdAt: true },
        orderBy: { name: "asc" },
      }),
    ["storefront-categories"],
    { tags: ["storefront:categories", "storefront:products"] },
  )();

  const normalizedCategorySlug = normalizeSlugSegment(categorySlug);
  const decodedSlug = normalizeSlugSegment(decodeURIComponent(categorySlug));
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

export async function getStorefrontCategoryPageData(categorySlug: string) {
  const category = await getActiveStorefrontCategoryBySlug(categorySlug);

  const [productCount, products] = await Promise.all([
    unstable_cache(
      async () =>
        db.product.count({
          where: {
            isActive: true,
            categoryId: category.id,
          },
        }),
      [`storefront-category-count:${category.id}`],
      { tags: ["storefront:products", "storefront:categories"] },
    )(),
    unstable_cache(
      async () =>
        db.product.findMany({
          where: {
            isActive: true,
            categoryId: category.id,
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
            category: { select: { name: true, slug: true } },
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
      [`storefront-category-products:${category.id}`],
      { tags: ["storefront:products", "storefront:categories"] },
    )(),
  ]);

  return { category, productCount, products };
}
