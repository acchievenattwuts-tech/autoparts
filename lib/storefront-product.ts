import { unstable_cache } from "next/cache";
import { db, withDbRetry } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma";

/**
 * Fitment chips are user-facing, so their order must not depend on the
 * database's row order. Declared as a typed constant (not inlined) so the
 * `as const` selects below keep a mutable array type Prisma accepts.
 */
const FITMENT_ORDER_BY: Prisma.ProductFitmentOrderByWithRelationInput[] = [
  { carModel: { name: "asc" } },
  { yearStart: "asc" },
  { id: "asc" },
];

export const getActiveStorefrontProductById = async (productId: string) => {
  return unstable_cache(
    // Retry once on a transient pooler drop so a background ISR revalidation does
    // not fail (and log an error) on a single dropped connection during a crawl.
    async () =>
      withDbRetry(() =>
      db.product.findFirst({
        where: {
          id: productId,
          isActive: true,
          isStorefrontVisible: true,
        },
        select: {
          id: true,
          categoryId: true,
          slug: true,
          code: true,
          name: true,
          description: true,
          imageUrl: true,
          saleUnitName: true,
          warrantyDays: true,
          retailPrice: true,
          images: {
            select: { url: true, alt: true, sortOrder: true, isPrimary: true },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          },
          salePrice: true,
          stock: true,
          category: { select: { id: true, name: true, slug: true } },
          brand: { select: { name: true } },
          aliases: {
            select: { alias: true },
            orderBy: { alias: "asc" },
            take: 8,
          },
          carModels: {
            select: {
              fitmentType: true,
              submodel: true,
              yearStart: true,
              yearEnd: true,
              engineCode: true,
              engineSize: true,
              note: true,
              carModel: {
                select: {
                  name: true,
                  carBrand: { select: { name: true } },
                },
              },
            },
            orderBy: [{ fitmentType: "asc" }, { carModelId: "asc" }, { yearStart: "asc" }],
            take: 16,
          },
          updatedAt: true,
        },
      }),
    ),
    [`storefront-product:${productId}`],
    {
      tags: ["storefront:products", `storefront-product:${productId}`],
      revalidate: 300,
    },
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
    // Retry once on a transient pooler drop so a background ISR revalidation does
    // not fail (and log an error) on a single dropped connection during a crawl.
    async () =>
      withDbRetry(() =>
      db.product.findMany({
        where: {
          isActive: true,
          isStorefrontVisible: true,
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
          retailPrice: true,
          saleUnitName: true,
          warrantyDays: true,
          stock: true,
          category: { select: { id: true, name: true, slug: true } },
          brand: { select: { name: true } },
          carModels: {
            orderBy: FITMENT_ORDER_BY,
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
        orderBy: [{ stock: "desc" }, { updatedAt: "desc" }],
        take: 9,
      }),
    ),
    [`storefront-related-products:${categoryId}:${currentProductId}`],
    {
      tags: ["storefront:products", `storefront-product:${currentProductId}`],
      revalidate: 300,
    },
  )();
};

const RELATED_SELECT = {
  id: true,
  slug: true,
  name: true,
  code: true,
  imageUrl: true,
  salePrice: true,
  retailPrice: true,
  saleUnitName: true,
  warrantyDays: true,
  stock: true,
  category: { select: { id: true, name: true, slug: true } },
  brand: { select: { name: true } },
  carModels: {
    orderBy: FITMENT_ORDER_BY,
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
} as const;

export const getRelatedStorefrontProductsPaginated = async ({
  categoryId,
  currentProductId,
  skip,
  take,
}: {
  categoryId: string;
  currentProductId: string;
  skip: number;
  take: number;
}) => {
  return db.product.findMany({
    where: {
      isActive: true,
      isStorefrontVisible: true,
      categoryId,
      id: { not: currentProductId },
    },
    select: RELATED_SELECT,
    orderBy: [{ stock: "desc" }, { updatedAt: "desc" }],
    skip,
    take,
  });
};

export const buildStorefrontProductDescription = (product: {
  name: string;
  description: string | null;
  code: string;
  brand: { name: string } | null;
  carModels: {
    fitmentType?: string;
    carModel: { name: string; carBrand: { name: string } };
  }[];
}) => {
  if (product.description?.trim()) {
    return product.description.trim();
  }

  const compatibleCars = product.carModels
    .filter((fitment) => fitment.fitmentType !== "COMPATIBLE")
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
