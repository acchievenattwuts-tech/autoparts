import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";

export const getStorefrontProductFilters = unstable_cache(
  async () => {
    const [categories, carBrands] = await Promise.all([
      db.category.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
      }),
      db.carBrand.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        include: {
          carModels: {
            where: { isActive: true },
            select: { id: true, name: true },
            orderBy: { name: "asc" },
          },
        },
      }),
    ]);

    return { categories, carBrands };
  },
  ["storefront-product-filters"],
  { tags: ["storefront-product-filters"] },
);
