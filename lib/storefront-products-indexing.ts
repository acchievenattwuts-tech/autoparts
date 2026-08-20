type QueryValue = string | string[] | undefined;

export interface ProductsIndexingSearchParams {
  q?: string;
  category?: string;
  brand?: string;
  model?: QueryValue;
  year?: string;
  page?: string;
  categories?: QueryValue;
  partsBrand?: QueryValue;
  carBrand?: QueryValue;
  yearMin?: string;
  yearMax?: string;
  priceMin?: string;
  priceMax?: string;
}

const hasQueryValue = (value: QueryValue) =>
  Array.isArray(value) ? value.some(Boolean) : Boolean(value);

export const shouldNoIndexProductsListing = (params: ProductsIndexingSearchParams) => {
  const parsedPage = Number.parseInt(params.page ?? "1", 10);
  const isPaginated = Number.isFinite(parsedPage) && parsedPage > 1;

  return Boolean(
    params.q ||
      params.category ||
      params.brand ||
      hasQueryValue(params.model) ||
      params.year ||
      isPaginated ||
      hasQueryValue(params.categories) ||
      hasQueryValue(params.partsBrand) ||
      hasQueryValue(params.carBrand) ||
      params.yearMin ||
      params.yearMax ||
      params.priceMin ||
      params.priceMax,
  );
};
