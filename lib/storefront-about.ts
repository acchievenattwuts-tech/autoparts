import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";

export const getStorefrontAboutStats = unstable_cache(
  async () => {
    const [activeProductCount, activeCategoryCount, activeBrandCount, activeModelCount] = await db.$transaction([
      db.product.count({ where: { isActive: true } }),
      db.category.count({ where: { isActive: true } }),
      db.carBrand.count({ where: { isActive: true } }),
      db.carModel.count({ where: { isActive: true } }),
    ]);

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
