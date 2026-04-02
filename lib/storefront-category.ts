import { unstable_cache } from "next/cache";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getProductCategorySlug } from "./product-slug";

export const getActiveStorefrontCategoryBySlug = async (categorySlug: string) => {
  const categories = await unstable_cache(
    async () =>
      db.category.findMany({
        where: { isActive: true },
        select: { id: true, name: true, createdAt: true },
        orderBy: { name: "asc" },
      }),
    ["storefront-categories"],
    { tags: ["storefront:categories", "storefront:products"] },
  )();

  const decodedSlug = decodeURIComponent(categorySlug);
  const category =
    categories.find((item) => item.name === decodedSlug) ??
    categories.find((item) => getProductCategorySlug(item.name) === categorySlug);
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
            code: true,
            imageUrl: true,
            salePrice: true,
            stock: true,
            reportUnitName: true,
            category: { select: { name: true } },
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
