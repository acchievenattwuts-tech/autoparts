import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";

const PRODUCTS_PER_PAGE = 24;
const STOREFRONT_LANDING_REVALIDATE_SECONDS = 1800;

export const getStorefrontProductFilters = unstable_cache(
  async () => {
    const categories = await db.category.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    const carBrands = await db.carBrand.findMany({
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
    });
    const partsBrands = await db.partsBrand.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });

    return { categories, carBrands, partsBrands };
  },
  ["storefront-product-filters-v3"],
  { tags: ["storefront-product-filters"], revalidate: 300 },
);

const getStorefrontProductsLandingPageProducts = unstable_cache(
  async () => {
    return db.product.findMany({
      where: { isActive: true, isStorefrontVisible: true },
      select: {
        id: true,
        slug: true,
        name: true,
        code: true,
        imageUrl: true,
        salePrice: true,
        saleUnitName: true,
        stock: true,
        category: { select: { id: true, name: true, slug: true } },
        brand: { select: { name: true } },
        carModels: {
          where: {
            fitmentType: "DIRECT",
            carModel: { isActive: true, carBrand: { isActive: true } },
          },
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
      orderBy: { createdAt: "desc" },
      take: PRODUCTS_PER_PAGE,
    });
  },
  ["storefront-products-landing-products"],
  { tags: ["storefront:products"], revalidate: STOREFRONT_LANDING_REVALIDATE_SECONDS },
);

const getStorefrontProductsLandingTotal = unstable_cache(
  async () =>
    db.product.count({
      where: { isActive: true, isStorefrontVisible: true },
    }),
  ["storefront-products-landing-total"],
  { tags: ["storefront:products"], revalidate: STOREFRONT_LANDING_REVALIDATE_SECONDS },
);

export const getStorefrontProductsLandingPageData = async () => {
  const products = await getStorefrontProductsLandingPageProducts();
  const totalProducts = await getStorefrontProductsLandingTotal();
  return { products, totalProducts };
};
