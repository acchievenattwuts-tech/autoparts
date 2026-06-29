import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";

export const getStorefrontAboutStats = unstable_cache(
  async () => {
    // Sequential awaits inside one interactive transaction keep all four counts on
    // a single pooled connection (the cache wrapper above already makes a real DB
    // hit rare) without the pg-adapter "client.query() while already executing"
    // warning the array/batch form emits.
    const { activeProductCount, activeCategoryCount, activeBrandCount, activeModelCount } =
      await db.$transaction(async (tx) => {
        const activeProductCount = await tx.product.count({
          where: { isActive: true, isStorefrontVisible: true },
        });
        const activeCategoryCount = await tx.category.count({ where: { isActive: true } });
        const activeBrandCount = await tx.carBrand.count({ where: { isActive: true } });
        const activeModelCount = await tx.carModel.count({ where: { isActive: true } });
        return { activeProductCount, activeCategoryCount, activeBrandCount, activeModelCount };
      });

    return {
      activeProductCount,
      activeCategoryCount,
      activeBrandCount,
      activeModelCount,
    };
  },
  ["storefront-about-stats"],
  {
    tags: ["storefront:products", "storefront:categories", "storefront-product-filters"],
    revalidate: 3600,
  },
);

export async function getPublicStorefrontAboutStats() {
  try {
    return await getStorefrontAboutStats();
  } catch (error) {
    console.warn("Falling back to default about stats", error);
    return {
      activeProductCount: 0,
      activeCategoryCount: 0,
      activeBrandCount: 0,
      activeModelCount: 0,
    };
  }
}
