export type AdminProductFilterParams = {
  search?: string;
  categoryId?: string;
  brandId?: string;
  carBrandId?: string;
  carModelId?: string;
  yearMin?: string;
  yearMax?: string;
  stockStatus?: string;
  statusFilter?: string;
  trackingFilter?: string;
};

const normalizeParam = (value?: string): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

export function parseAdminProductFilterParams(
  params: Record<string, string | undefined>,
): AdminProductFilterParams {
  const parsed: AdminProductFilterParams = {
    search: normalizeParam(params.search),
    categoryId: normalizeParam(params.categoryId),
    brandId: normalizeParam(params.brandId),
    carBrandId: normalizeParam(params.carBrandId),
    carModelId: normalizeParam(params.carModelId),
    yearMin: normalizeParam(params.yearMin),
    yearMax: normalizeParam(params.yearMax),
    stockStatus: normalizeParam(params.stockStatus),
    statusFilter: normalizeParam(params.statusFilter),
    trackingFilter: normalizeParam(params.trackingFilter),
  };

  return Object.fromEntries(
    Object.entries(parsed).flatMap(([key, value]) => (value ? [[key, value]] : [])),
  ) as AdminProductFilterParams;
}

export function buildAdminProductFilterSearchParams(
  params: AdminProductFilterParams & { page?: string },
): Record<string, string> {
  const entries = Object.entries({
    search: params.search,
    page: params.page,
    categoryId: params.categoryId,
    brandId: params.brandId,
    carBrandId: params.carBrandId,
    carModelId: params.carModelId,
    yearMin: params.yearMin,
    yearMax: params.yearMax,
    stockStatus: params.stockStatus,
    statusFilter: params.statusFilter,
    trackingFilter: params.trackingFilter,
  });

  return Object.fromEntries(
    entries.flatMap(([key, value]) => {
      const normalized = normalizeParam(value);
      return normalized ? [[key, normalized]] : [];
    }),
  );
}
