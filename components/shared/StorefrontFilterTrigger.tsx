"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
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
  filterData: ProductFilterData;
}

const StorefrontFilterTrigger = ({ filterData }: Props) => {
  const pathname = usePathname();
  const router = useRouter();
  const isOnProducts = pathname === "/products";

  const [count, setCount] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!isOnProducts) {
      setCount(0);
      return;
    }
    setCount(computeFilterCount(window.location.search));

    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ search?: string }>).detail;
      if (typeof detail?.search === "string") {
        setCount(computeFilterCount(detail.search));
      } else {
        setCount(computeFilterCount(window.location.search));
      }
    };
    window.addEventListener(PRODUCT_FILTER_COUNT_EVENT, handler);
    window.addEventListener("popstate", handler);
    return () => {
      window.removeEventListener(PRODUCT_FILTER_COUNT_EVENT, handler);
      window.removeEventListener("popstate", handler);
    };
  }, [isOnProducts, pathname]);

  const handleClick = () => {
    if (isOnProducts) {
      // ProductFilterBar already manages drawer state with current applied filters
      window.dispatchEvent(new CustomEvent(OPEN_PRODUCT_FILTER_EVENT));
    } else {
      // Open our own drawer on non-/products pages
      setDrawerOpen(true);
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
        className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-[#1e3a5f] shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50 hover:ring-[#1e3a5f]/30 md:hidden"
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
        <ProductFilterDrawer
          isOpen={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          initialFilters={EMPTY_FILTERS}
          filterData={filterData}
          onApply={handleDrawerApply}
          onClear={handleDrawerClear}
        />
      )}
    </>
  );
};

export default StorefrontFilterTrigger;
