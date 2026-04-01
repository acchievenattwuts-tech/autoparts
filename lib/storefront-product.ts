import { cache } from "react";
import { db } from "@/lib/db";

export const getActiveStorefrontProductById = cache(async (productId: string) => {
  return db.product.findFirst({
    where: {
      id: productId,
      isActive: true,
    },
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      imageUrl: true,
      salePrice: true,
      stock: true,
      reportUnitName: true,
      category: { select: { name: true } },
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
  });
});

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
