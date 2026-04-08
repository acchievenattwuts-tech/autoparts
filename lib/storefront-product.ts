import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";

export const getActiveStorefrontProductById = async (productId: string) => {
  return unstable_cache(
    async () =>
      db.product.findFirst({
        where: {
          id: productId,
          isActive: true,
        },
        select: {
          id: true,
          categoryId: true,
          slug: true,
          code: true,
          name: true,
          description: true,
          imageUrl: true,
          salePrice: true,
          stock: true,
          reportUnitName: true,
          category: { select: { id: true, name: true, slug: true } },
          brand: { select: { name: true } },
          aliases: {
            select: { alias: true },
            orderBy: { alias: "asc" },
            take: 8,
          },
          carModels: {
            select: {
              carModel: {
                select: {
                  name: true,
                  carBrand: { select: { name: true } },
                },
              },
            },
            take: 16,
          },
          updatedAt: true,
        },
      }),
    [`storefront-product:${productId}`],
    { tags: [`storefront-product:${productId}`] },
  )();
};

export const getRelatedStorefrontProductsByCategory = async ({
  categoryId,
  currentProductId,
}: {
  categoryId: string;
  currentProductId: string;
}) => {
  return unstable_cache(
    async () =>
      db.product.findMany({
        where: {
          isActive: true,
          categoryId,
          id: { not: currentProductId },
        },
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
        orderBy: [{ stock: "desc" }, { updatedAt: "desc" }],
        take: 4,
      }),
    [`storefront-related-products:${categoryId}:${currentProductId}`],
    { tags: ["storefront:products", `storefront-product:${currentProductId}`] },
  )();
};

export const buildStorefrontProductDescription = (product: {
  name: string;
  description: string | null;
  code: string;
  brand: { name: string } | null;
  carModels: { carModel: { name: string; carBrand: { name: string } } }[];
}) => {
  if (product.description?.trim()) {
    return product.description.trim();
  }

  const compatibleCars = product.carModels
    .slice(0, 3)
    .map(({ carModel }) => `${carModel.carBrand.name} ${carModel.name}`);

  return [
    product.name,
    product.brand?.name ? `แบรนด์ ${product.brand.name}` : null,
    compatibleCars.length > 0 ? `รองรับ ${compatibleCars.join(", ")}` : null,
    `รหัสสินค้า ${product.code}`,
  ]
    .filter(Boolean)
    .join(" | ");
};
