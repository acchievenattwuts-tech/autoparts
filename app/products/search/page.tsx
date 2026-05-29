export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";

type QueryValue = string | string[] | undefined;

interface Props {
  searchParams: Promise<{
    q?: string;
    category?: string;
    brand?: string;
    model?: QueryValue;
    year?: string;
    page?: string;
  }>;
}

// Redirect all /products/search?... to /products?... for backward compatibility
const SearchRedirectPage = async ({ searchParams }: Props) => {
  const { q, category, brand, model, year, page } = await searchParams;
  const params = new URLSearchParams();

  if (q) params.set("q", q);
  if (category) params.set("category", category);
  if (brand) params.set("brand", brand);
  if (year) params.set("year", year);
  if (page && page !== "1") params.set("page", page);

  const models = Array.isArray(model) ? model : model ? [model] : [];
  models.filter(Boolean).forEach((m) => params.append("model", m));

  const query = params.toString();
  redirect(query ? `/products?${query}` : "/products");
};

export default SearchRedirectPage;
