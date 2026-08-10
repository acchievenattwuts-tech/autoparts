import type { ProductFilterData } from "@/components/shared/ProductFilterPanel";

/**
 * Client-side loader for the storefront filter master data (categories, car
 * brands + their models, parts brands).
 *
 * The payload is the same for every visitor, so it is fetched from the
 * `force-static` `/api/storefront-filters` route on first use instead of being
 * serialised into every page's flight payload. The homepage used to ship the
 * whole car brand→model map (~1.8KB, and an RSC page carries it twice — once in
 * the HTML, once in the flight payload) to every visitor including the crawlers
 * that never touch a dropdown; now only the brand names travel with the page.
 *
 * The result is memoised at module scope, so the filter drawer and the hero's
 * fitment finder share one request per page load. In-flight calls are shared too,
 * so two components mounting at once do not fetch twice.
 */

const FILTER_DATA_ENDPOINT = "/api/storefront-filters";

let cachedFilterData: ProductFilterData | null = null;
let inFlightRequest: Promise<ProductFilterData> | null = null;

/** The already-loaded data, if any — lets callers skip a loading state. */
export const getCachedStorefrontFilterData = (): ProductFilterData | null => cachedFilterData;

/** Seeds the cache from data a Server Component already had in hand. */
export const primeStorefrontFilterData = (data: ProductFilterData): void => {
  cachedFilterData = data;
};

export const loadStorefrontFilterData = async (): Promise<ProductFilterData> => {
  if (cachedFilterData) {
    return cachedFilterData;
  }

  if (!inFlightRequest) {
    inFlightRequest = fetch(FILTER_DATA_ENDPOINT, {
      method: "GET",
      credentials: "same-origin",
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to load filters: ${response.status}`);
        }

        const payload = (await response.json()) as ProductFilterData;
        cachedFilterData = payload;
        return payload;
      })
      .finally(() => {
        inFlightRequest = null;
      });
  }

  return inFlightRequest;
};
