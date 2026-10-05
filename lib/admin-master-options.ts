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

type MasterOption = { id: string; name: string };

export type AdminProductFilterOptions = {
  categories: MasterOption[];
  partsBrands: MasterOption[];
  carBrands: Array<MasterOption & { carModels: MasterOption[] }>;
};

const toMasterOption = ({ id, name }: MasterOption): MasterOption => ({ id, name });

/** Active categories as id/name filter options (cached master list). */
export const getActiveCategoryFilterOptions = async (): Promise<MasterOption[]> =>
  (await getActiveCategoryOptions()).map(toMasterOption);

/** Active car brands with their active models as id/name filter options (cached master list). */
export const getActiveCarBrandFilterOptions = async (): Promise<AdminProductFilterOptions["carBrands"]> =>
  (await getActiveCarBrandOptionsWithModels()).map(({ id, name, carModels }) => ({
    id,
    name,
    carModels: carModels.map(toMasterOption),
  }));

/**
 * Category / parts-brand / car-brand+model options for the admin product list and
 * product search filters, served from the cached master lists above. Those two
 * pages re-render on every filter change and pagination, and querying the three
 * tables directly cost ~16.5 KB of database egress per render (462 renders on
 * 2026-10-03). Trimmed to id/name so the RSC payload stays small too.
 */
export const getAdminProductFilterOptions = async (): Promise<AdminProductFilterOptions> => {
  const [categories, partsBrands, carBrands] = await Promise.all([
    getActiveCategoryFilterOptions(),
    getActivePartsBrandOptions(),
    getActiveCarBrandFilterOptions(),
  ]);
  return {
    categories,
    partsBrands: partsBrands.map(toMasterOption),
    carBrands,
  };
};

/**
 * Every category, inactive ones included, as id/name options — for report filters
 * where products in a retired category still carry stock or history. Shares the
 * categories tag, so every category mutation refreshes it too.
 */
export const getAllCategoryFilterOptions = unstable_cache(
  async (): Promise<MasterOption[]> =>
    withDbRetry(() => db.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })),
  ["admin-master-categories-all-v1"],
  { tags: [ADMIN_MASTER_OPTION_TAGS.categories], revalidate: MASTER_OPTIONS_REVALIDATE_SECONDS },
);

export const loadActiveCustomerTypeOptions = async () =>
  withDbRetry(() =>
    db.customerType.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        priceListId: true,
        priceList: { select: { code: true, name: true, channel: true } },
      },
    }),
  );

export const getActiveCustomerTypeOptions = unstable_cache(
  loadActiveCustomerTypeOptions,
  ["admin-master-customer-types-v2"],
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
