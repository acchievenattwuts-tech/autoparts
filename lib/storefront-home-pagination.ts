import type { StorefrontProductPage } from "@/lib/storefront-home";

export const MAX_HOME_NEW_ARRIVALS_PAGE = 500;

export const parseHomeNewArrivalsPage = (rawPage: string | null): number | null => {
  if (!rawPage || !/^[1-9]\d*$/.test(rawPage)) return null;

  const page = Number(rawPage);
  return Number.isSafeInteger(page) && page <= MAX_HOME_NEW_ARRIVALS_PAGE ? page : null;
};

const isStorefrontProductPage = (value: unknown): value is StorefrontProductPage => {
  if (!value || typeof value !== "object") return false;

  const page = value as Partial<StorefrontProductPage>;
  return (
    Array.isArray(page.products) &&
    page.products.every(
      (product) =>
        Boolean(product) &&
        typeof product === "object" &&
        typeof (product as { id?: unknown }).id === "string",
    ) &&
    typeof page.total === "number" &&
    Number.isInteger(page.total) &&
    typeof page.page === "number" &&
    Number.isInteger(page.page) &&
    typeof page.pageSize === "number" &&
    Number.isInteger(page.pageSize)
  );
};

export const fetchHomeNewArrivalsPage = async (
  page: number,
  fetcher: typeof fetch = fetch,
): Promise<StorefrontProductPage> => {
  if (parseHomeNewArrivalsPage(String(page)) === null) {
    throw new Error("Invalid new-arrivals page");
  }

  const response = await fetcher(`/api/storefront/new-arrivals?page=${page}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`New-arrivals request failed with status ${response.status}`);
  }

  const result: unknown = await response.json();
  if (!isStorefrontProductPage(result)) {
    throw new Error("Invalid new-arrivals response");
  }

  return result;
};
