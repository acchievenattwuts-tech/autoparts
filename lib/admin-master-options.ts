import { unstable_cache } from "next/cache";

import { db } from "@/lib/db";

// Group-A master data: changes rarely, read repeatedly as dropdown options in
// admin forms. Cached with a per-entity tag; each master's CRUD action calls
// `updateTag(...)` so an edit invalidates the cache immediately (no stale list).
// None of these models has a Decimal field, so the records round-trip through
// unstable_cache cleanly.
const MASTER_OPTIONS_REVALIDATE_SECONDS = 300;

export const ADMIN_MASTER_OPTION_TAGS = {
  categories: "admin-master:categories",
  carBrands: "admin-master:car-brands",
  partsBrands: "admin-master:parts-brands",
  expenseCodes: "admin-master:expense-codes",
} as const;

export const getActiveCategoryOptions = unstable_cache(
  async () => db.category.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ["admin-master-categories-v1"],
  { tags: [ADMIN_MASTER_OPTION_TAGS.categories], revalidate: MASTER_OPTIONS_REVALIDATE_SECONDS },
);

export const getActiveCarBrandOptionsWithModels = unstable_cache(
  async () =>
    db.carBrand.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      include: {
        carModels: { where: { isActive: true }, orderBy: { name: "asc" } },
      },
    }),
  ["admin-master-car-brands-v1"],
  { tags: [ADMIN_MASTER_OPTION_TAGS.carBrands], revalidate: MASTER_OPTIONS_REVALIDATE_SECONDS },
);

export const getActivePartsBrandOptions = unstable_cache(
  async () => db.partsBrand.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ["admin-master-parts-brands-v1"],
  { tags: [ADMIN_MASTER_OPTION_TAGS.partsBrands], revalidate: MASTER_OPTIONS_REVALIDATE_SECONDS },
);

export const getActiveExpenseCodeOptions = unstable_cache(
  async () =>
    db.expenseCode.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }),
  ["admin-master-expense-codes-v1"],
  { tags: [ADMIN_MASTER_OPTION_TAGS.expenseCodes], revalidate: MASTER_OPTIONS_REVALIDATE_SECONDS },
);
