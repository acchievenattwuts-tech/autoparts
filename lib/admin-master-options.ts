import { unstable_cache } from "next/cache";

import { db, withDbRetry } from "@/lib/db";

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
  customerTypes: "admin-master:customer-types",
} as const;

export const loadActiveCategoryOptions = async () =>
  withDbRetry(() => db.category.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }));

export const getActiveCategoryOptions = unstable_cache(
  loadActiveCategoryOptions,
  ["admin-master-categories-v1"],
  { tags: [ADMIN_MASTER_OPTION_TAGS.categories], revalidate: MASTER_OPTIONS_REVALIDATE_SECONDS },
);

export const loadActiveCarBrandOptionsWithModels = async () =>
  withDbRetry(() =>
    db.carBrand.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      include: {
        carModels: { where: { isActive: true }, orderBy: { name: "asc" } },
      },
    }),
  );

export const getActiveCarBrandOptionsWithModels = unstable_cache(
  loadActiveCarBrandOptionsWithModels,
  ["admin-master-car-brands-v1"],
  { tags: [ADMIN_MASTER_OPTION_TAGS.carBrands], revalidate: MASTER_OPTIONS_REVALIDATE_SECONDS },
);

export const loadActivePartsBrandOptions = async () =>
  withDbRetry(() => db.partsBrand.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }));

export const getActivePartsBrandOptions = unstable_cache(
  loadActivePartsBrandOptions,
  ["admin-master-parts-brands-v1"],
  { tags: [ADMIN_MASTER_OPTION_TAGS.partsBrands], revalidate: MASTER_OPTIONS_REVALIDATE_SECONDS },
);

export const loadActiveCustomerTypeOptions = async () =>
  withDbRetry(() =>
    db.customerType.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, showPrice: true },
    }),
  );

export const getActiveCustomerTypeOptions = unstable_cache(
  loadActiveCustomerTypeOptions,
  ["admin-master-customer-types-v1"],
  { tags: [ADMIN_MASTER_OPTION_TAGS.customerTypes], revalidate: MASTER_OPTIONS_REVALIDATE_SECONDS },
);

export const loadActiveExpenseCodeOptions = async () =>
  withDbRetry(() =>
    db.expenseCode.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }),
  );

export const getActiveExpenseCodeOptions = unstable_cache(
  loadActiveExpenseCodeOptions,
  ["admin-master-expense-codes-v1"],
  { tags: [ADMIN_MASTER_OPTION_TAGS.expenseCodes], revalidate: MASTER_OPTIONS_REVALIDATE_SECONDS },
);
