"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  EMPTY_FILTERS,
  ProductFilterDrawer,
  type AppliedFilters,
  type ProductFilterData,
} from "@/components/shared/ProductFilterPanel";

const FILTER_ICON = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 5h18M6 12h12M10 19h4" />
  </svg>
);

// Event name shared with ProductFilterBar — clicking the navbar trigger on /products
// dispatches this so the existing drawer (with current filter state) opens.
export const OPEN_PRODUCT_FILTER_EVENT = "storefront:open-product-filter";

// Custom event fired by SearchResults whenever filters change — keeps the badge
// count in sync without depending on useSearchParams (which would require a
// Suspense boundary for static pages like / and /about).
export const PRODUCT_FILTER_COUNT_EVENT = "storefront:product-filter-count";

let sharedFilterData: ProductFilterData | null = null;
let sharedFilterDataPromise: Promise<ProductFilterData> | null = null;
let filterCountSearchOverride: string | null = null;

const computeFilterCount = (search: string): number => {
  if (!search) return 0;
  const params = new URLSearchParams(search);
  let total = 0;
  total += params.getAll("categories").length;
  total += params.getAll("partsBrand").length;
  total += params.getAll("carBrand").length;
  total += params.getAll("model").length;
  if (params.get("yearMin")) total += 1;
  if (params.get("yearMax")) total += 1;
  if (params.get("priceMin")) total += 1;
  if (params.get("priceMax")) total += 1;
  return total;
};

const buildProductsUrl = (draft: AppliedFilters): string => {
  const params = new URLSearchParams();
  draft.categories.forEach((c) => params.append("categories", c));
  draft.partsBrands.forEach((b) => params.append("partsBrand", b));
  draft.carBrands.forEach((b) => params.append("carBrand", b));
  draft.models.forEach((m) => params.append("model", m));
  if (draft.yearMin !== null) params.set("yearMin", String(draft.yearMin));
  if (draft.yearMax !== null) params.set("yearMax", String(draft.yearMax));
  if (draft.priceMin !== null) params.set("priceMin", String(draft.priceMin));
  if (draft.priceMax !== null) params.set("priceMax", String(draft.priceMax));
  const qs = params.toString();
  return qs ? `/products?${qs}` : "/products";
};

interface Props {
  filterData?: ProductFilterData;
}

const FILTER_DATA_ENDPOINT = "/api/storefront-filters";

const LoadingFilterDrawer = ({ onClose }: { onClose: () => void }) => {
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] lg:hidden" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="absolute inset-x-0 bottom-0 top-12 flex flex-col rounded-t-3xl bg-white shadow-2xl">
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-[#f97316]" />
          <div>
            <p className="font-kanit text-lg font-semibold text-[#10213d]">กำลังโหลดตัวกรอง</p>
            <p className="mt-1 text-sm text-slate-500">เตรียมหมวดสินค้า ยี่ห้อ และรุ่นรถก่อนเปิดแผงกรอง</p>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

const loadSharedFilterData = async (): Promise<ProductFilterData> => {
  if (sharedFilterData) {
    return sharedFilterData;
  }

  if (!sharedFilterDataPromise) {
    sharedFilterDataPromise = fetch(FILTER_DATA_ENDPOINT, {
      method: "GET",
      credentials: "same-origin",
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to load filters: ${response.status}`);
        }

        const payload = (await response.json()) as ProductFilterData;
        sharedFilterData = payload;
        return payload;
      })
      .finally(() => {
        sharedFilterDataPromise = null;
      });
  }

  return sharedFilterDataPromise;
};

const StorefrontFilterTrigger = ({ filterData }: Props) => {
  const pathname = usePathname();
  const router = useRouter();
  const isOnProducts = pathname === "/products";

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [resolvedFilterData, setResolvedFilterData] = useState<ProductFilterData | null>(
    filterData ?? null,
  );
  const [isLoadingFilterData, setIsLoadingFilterData] = useState(false);

  useEffect(() => {
    if (filterData) {
      sharedFilterData = filterData;
      setResolvedFilterData(filterData);
    }
  }, [filterData]);

  const subscribeFilterCount = useCallback(
    (onStoreChange: () => void) => {
      filterCountSearchOverride = null;
      if (!isOnProducts) return () => {};

      const handler = (event: Event) => {
        const detail = (event as CustomEvent<{ search?: string }>).detail;
        if (typeof detail?.search === "string") {
          filterCountSearchOverride = detail.search;
        } else {
          filterCountSearchOverride = null;
        }
        onStoreChange();
      };
      window.addEventListener(PRODUCT_FILTER_COUNT_EVENT, handler);
      window.addEventListener("popstate", handler);
      return () => {
        window.removeEventListener(PRODUCT_FILTER_COUNT_EVENT, handler);
        window.removeEventListener("popstate", handler);
      };
    },
    [isOnProducts],
  );

  const getFilterCountSnapshot = useCallback(() => {
    if (!isOnProducts || typeof window === "undefined") return 0;
    return computeFilterCount(filterCountSearchOverride ?? window.location.search);
  }, [isOnProducts]);

  const count = useSyncExternalStore(subscribeFilterCount, getFilterCountSnapshot, () => 0);

  const ensureFilterData = useCallback(async () => {
    if (resolvedFilterData || isLoadingFilterData) {
      return;
    }

    setIsLoadingFilterData(true);

    try {
      const payload = await loadSharedFilterData();
      setResolvedFilterData(payload);
    } catch {
      setDrawerOpen(false);
      router.push("/products");
    } finally {
      setIsLoadingFilterData(false);
    }
  }, [isLoadingFilterData, resolvedFilterData, router]);

  const handleClick = () => {
    if (isOnProducts) {
      // ProductFilterBar already manages drawer state with current applied filters
      window.dispatchEvent(new CustomEvent(OPEN_PRODUCT_FILTER_EVENT));
    } else {
      // Open our own drawer on non-/products pages
      setDrawerOpen(true);
      void ensureFilterData();
    }
  };

  const handleDrawerApply = useCallback(
    (draft: AppliedFilters) => {
      setDrawerOpen(false);
      router.push(buildProductsUrl(draft));
    },
    [router],
  );

  const handleDrawerClear = useCallback(() => {
    setDrawerOpen(false);
    router.push("/products");
  }, [router]);

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-[#1e3a5f] shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50 hover:ring-[#1e3a5f]/30 lg:hidden"
        aria-label="ตัวกรองสินค้า"
      >
        {FILTER_ICON}
        {count > 0 && (
          <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#f97316] px-1.5 text-[10px] font-semibold text-white shadow-sm">
            {count}
          </span>
        )}
      </button>

      {/* Drawer for non-/products pages — Apply navigates to /products with filter params.
          On /products itself, ProductFilterBar's own drawer is used instead. */}
      {!isOnProducts && (
        <>
          {drawerOpen && !resolvedFilterData && (
            <LoadingFilterDrawer onClose={() => setDrawerOpen(false)} />
          )}
          {resolvedFilterData && (
            <ProductFilterDrawer
              isOpen={drawerOpen}
              onClose={() => setDrawerOpen(false)}
              initialFilters={EMPTY_FILTERS}
              filterData={resolvedFilterData}
              onApply={handleDrawerApply}
              onClear={handleDrawerClear}
            />
          )}
        </>
      )}
    </>
  );
};

export default StorefrontFilterTrigger;
