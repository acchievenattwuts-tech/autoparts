import type { Prisma } from "@/lib/generated/prisma";

const buildContainsCondition = (query: string): Prisma.ProductWhereInput => ({
  OR: [
    { name: { contains: query, mode: "insensitive" } },
    { code: { contains: query, mode: "insensitive" } },
    { description: { contains: query, mode: "insensitive" } },
    { aliases: { some: { alias: { contains: query, mode: "insensitive" } } } },
    { carModels: { some: { carModel: { name: { contains: query, mode: "insensitive" } } } } },
    { carModels: { some: { carModel: { carBrand: { name: { contains: query, mode: "insensitive" } } } } } },
    { category: { name: { contains: query, mode: "insensitive" } } },
    { brand: { name: { contains: query, mode: "insensitive" } } },
  ],
});

export const buildProductSearchWhere = (
  query?: string | null,
): Prisma.ProductWhereInput | undefined => {
  const normalized = query?.trim();
  if (!normalized) {
    return undefined;
  }

  return buildContainsCondition(normalized);
};
