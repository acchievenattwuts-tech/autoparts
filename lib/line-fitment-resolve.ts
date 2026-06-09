import { db } from "@/lib/db";

/**
 * Resolves the AI-extracted fitment hints (free-text brand/model/part type) to the
 * EXACT canonical names stored in master data, so they can be used as hard filters
 * in product search (which match by exact name `IN (...)`).
 *
 * Safety-first: a hint becomes a hard filter ONLY when it resolves to a real,
 * active master row. An unresolved hint is dropped (left to the free-text query),
 * so a typo or an unknown brand can never zero-out an otherwise valid search.
 */

export type LineFitmentFilterInput = {
  partType?: string | null;
  carBrand?: string | null;
  carModel?: string | null;
};

export type LineFitmentFilters = {
  categoryName?: string;
  carBrandName?: string;
  carModelName?: string;
};

const trimOrNull = (value?: string | null): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/**
 * Case-insensitive resolution against CarBrand / CarModel / Category. Prefers an
 * exact (insensitive) name match; for car models, scopes to the resolved brand and
 * falls back to a `contains` match (e.g. AI "Mazda 2" vs master "2").
 */
export async function resolveLineFitmentFilters(
  input: LineFitmentFilterInput,
): Promise<LineFitmentFilters> {
  const carBrand = trimOrNull(input.carBrand);
  const carModel = trimOrNull(input.carModel);
  const partType = trimOrNull(input.partType);

  const filters: LineFitmentFilters = {};

  try {
    const [brandRow, categoryRow] = await Promise.all([
      carBrand
        ? db.carBrand.findFirst({
            where: { isActive: true, name: { equals: carBrand, mode: "insensitive" } },
            select: { id: true, name: true },
          })
        : Promise.resolve(null),
      partType
        ? db.category.findFirst({
            where: {
              isActive: true,
              OR: [
                { name: { equals: partType, mode: "insensitive" } },
                { name: { contains: partType, mode: "insensitive" } },
              ],
            },
            select: { name: true },
          })
        : Promise.resolve(null),
    ]);

    if (categoryRow) filters.categoryName = categoryRow.name;
    if (brandRow) filters.carBrandName = brandRow.name;

    // Car model only when we have a resolved brand to scope it (model names like
    // "2" / "City" are ambiguous across brands). Exact first, then contains.
    if (brandRow && carModel) {
      const modelRow =
        (await db.carModel.findFirst({
          where: {
            isActive: true,
            carBrandId: brandRow.id,
            name: { equals: carModel, mode: "insensitive" },
          },
          select: { name: true },
        })) ??
        (await db.carModel.findFirst({
          where: {
            isActive: true,
            carBrandId: brandRow.id,
            name: { contains: carModel, mode: "insensitive" },
          },
          select: { name: true },
        }));
      if (modelRow) filters.carModelName = modelRow.name;
    }
  } catch {
    // Resolution is best-effort precision; never block search on a lookup failure.
    return {};
  }

  return filters;
}
