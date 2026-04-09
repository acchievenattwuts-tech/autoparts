import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";

const PRODUCTS_PER_PAGE = 24;

export const getStorefrontProductFilters = unstable_cache(
  async () => {
    const [categories, carBrands] = await Promise.all([
      db.category.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      db.carBrand.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          carModels: {
            where: { isActive: true },
            select: { id: true, name: true },
            orderBy: { name: "asc" },
          },
        },
        orderBy: { name: "asc" },
      }),
    ]);

    return { categories, carBrands };
  },
  ["storefront-product-filters"],
  { tags: ["storefront-product-filters"] },
);

export const getStorefrontProductsLandingPageData = unstable_cache(
  async () => {
    const [products, totalProducts] = await Promise.all([
      db.product.findMany({
        where: { isActive: true },
        select: {
          id: true,
          slug: true,
          name: true,
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
        orderBy: { createdAt: "desc" },
        take: PRODUCTS_PER_PAGE,
      }),
      db.product.count({ where: { isActive: true } }),
    ]);

    return { products, totalProducts };
  },
  ["storefront-products-landing"],
  { tags: ["storefront:products"], revalidate: 300 },
);
