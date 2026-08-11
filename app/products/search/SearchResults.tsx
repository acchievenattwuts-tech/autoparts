"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import ProductCard from "@/components/shared/ProductCard";
import { HIDE_STOREFRONT_PRICE } from "@/lib/storefront-pricing";
import type { SearchProductItem } from "@/lib/storefront-product-search";
import ProductFilterBar from "../ProductFilterBar";
import {
  loadMoreSearchProductsAction,
  searchProductsAction,
  type SearchFilterInput,
} from "./search-products-actions";
import { PRODUCT_FILTER_COUNT_EVENT } from "@/components/shared/StorefrontFilterTrigger";
import { resolveStorefrontSearchQuery } from "@/lib/storefront-search-query-bus";

const AUTO_LOAD_PAGE_LIMIT = 5;

type CarBrand = {
  id: string;
  name: string;
  carModels: Array<{ id: string; name: string }>;
};
type Category = { id: string; name: string };
type PartsBrand = { id: string; name: string };

type FilterData = {
  carBrands: CarBrand[];
  categories: Category[];
  partsBrands: PartsBrand[];
};

type FiltersState = {
  q: string;
  brand: string;
  models: string[];
  category: string;
  year: number | null;
  page: number;
  // Multi-select Filter UI v2
  categories: string[];
  partsBrands: string[];
  carBrands: string[];
  yearMin: number | null;
  yearMax: number | null;
  priceMin: number | null;
  priceMax: number | null;
};

type RequiredTokenFallback = {
  requiredTokens: string[];
  usedFallback: boolean;
};

interface Props {
  initialProducts: SearchProductItem[];
  initialTotal: number;
  initialDidYouMean: string[];
  initialFilters: FiltersState;
  initialMeta: {
    pageStart: number;
    pageEnd: number;
    totalPages: number;
  };
  initialRequiredTokenFallback?: RequiredTokenFallback;
  filterData: FilterData;
  lineUrl: string;
  /** Base path for URL updates via router.replace. Defaults to /products */
  basePath?: string;
  /**
   * Unique value generated server-side on every render (Date.now()).
   * AJAX filter changes call router.replace → background server re-render → new nonce,
   * but isAjaxUpdateRef skips the state reset. Only external navigations (nav links,
   * browser back) bypass the flag and trigger a full state reset.
   */
  renderNonce: string;
}

const buildSearchUrl = (f: FiltersState, basePath: string): string => {
  const params = new URLSearchParams();
  if (f.q) params.set("q", f.q);
  if (f.category) params.set("category", f.category);
  if (f.brand) params.set("brand", f.brand);
  f.models.forEach((m) => params.append("model", m));
  if (f.year) params.set("year", String(f.year));
  // Multi-select v2
  f.categories.forEach((c) => params.append("categories", c));
  f.partsBrands.forEach((b) => params.append("partsBrand", b));
  f.carBrands.forEach((b) => params.append("carBrand", b));
  if (f.yearMin !== null) params.set("yearMin", String(f.yearMin));
  if (f.yearMax !== null) params.set("yearMax", String(f.yearMax));
  if (f.priceMin !== null) params.set("priceMin", String(f.priceMin));
  if (f.priceMax !== null) params.set("priceMax", String(f.priceMax));
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
};

const ProductCardSkeleton = () => (
  <div className="h-full min-h-[22.25rem] overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm sm:min-h-[25.75rem] lg:min-h-[26.25rem]">
    <div className="aspect-square w-full animate-pulse bg-slate-100" />
    <div className="space-y-3 p-3 sm:p-4">
      <div className="h-5 w-20 animate-pulse rounded-full bg-slate-100" />
      <div className="space-y-2">
        <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
        <div className="h-4 w-4/5 animate-pulse rounded bg-slate-100" />
      </div>
      <div className="h-3 w-1/2 animate-pulse rounded bg-slate-100" />
      <div className="pt-6">
        <div className="h-3 w-16 animate-pulse rounded bg-slate-100" />
        <div className="mt-2 h-7 w-24 animate-pulse rounded bg-slate-100" />
      </div>
    </div>
  </div>
);

const SearchResults = ({
  initialProducts,
  initialTotal,
  initialDidYouMean,
  initialFilters,
  initialMeta,
  initialRequiredTokenFallback,
  filterData,
  lineUrl,
  basePath = "/products",
  renderNonce,
}: Props) => {
  const [products, setProducts] = useState<SearchProductItem[]>(initialProducts);
  const [total, setTotal] = useState(initialTotal);
  const [didYouMean, setDidYouMean] = useState<string[]>(initialDidYouMean);
  const [filters, setFilters] = useState<FiltersState>(initialFilters);
  const [meta, setMeta] = useState(initialMeta);
  const [requiredTokenFallback, setRequiredTokenFallback] = useState<
    RequiredTokenFallback | undefined
  >(initialRequiredTokenFallback);
  // Set when the server declined to run the search because this visitor is over
  // the per-minute ceiling. Shown as a "please wait a moment" notice above the
  // grid, with the previous results left in place.
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [isTransitionPending, startTransition] = useTransition();
  const [isRouteSyncPending, setIsRouteSyncPending] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const isPending = isTransitionPending || isRouteSyncPending;
  const [animKey, setAnimKey] = useState(0);
  const gridSectionRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const prevNonceRef = useRef(renderNonce);
  const latestRequestIdRef = useRef(0);
  const latestLoadMoreIdRef = useRef(0);
  // true while a server re-render is triggered by our own AJAX filter (not user nav)
  const isAjaxUpdateRef = useRef(false);
  const router = useRouter();

  useEffect(() => {
    if (prevNonceRef.current === renderNonce) return;
    prevNonceRef.current = renderNonce;

    if (isAjaxUpdateRef.current) {
      // Background server re-render from our own router.replace — skip state reset
      isAjaxUpdateRef.current = false;
      setIsRouteSyncPending(false);
      return;
    }

    setIsRouteSyncPending(false);

    // External navigation (nav link, browser back/forward) — reset to server state
    setProducts(initialProducts);
    setTotal(initialTotal);
    setDidYouMean(initialDidYouMean);
    setFilters(initialFilters);
    setMeta(initialMeta);
    setRequiredTokenFallback(initialRequiredTokenFallback);
    setIsLoadingMore(false);
    setAnimKey((k) => k + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderNonce]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  useEffect(() => {
    const resetToInitial = (scrollToTop: boolean) => {
      setProducts(initialProducts);
      setTotal(initialTotal);
      setDidYouMean(initialDidYouMean);
      setFilters(initialFilters);
      setMeta(initialMeta);
      setRequiredTokenFallback(initialRequiredTokenFallback);
      setIsLoadingMore(false);
      setAnimKey((k) => k + 1);
      if (scrollToTop) window.scrollTo({ top: 0, behavior: "auto" });
    };

    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) resetToInitial(true);
    };

    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, [
    initialDidYouMean,
    initialFilters,
    initialMeta,
    initialProducts,
    initialRequiredTokenFallback,
    initialTotal,
  ]);

  const applyFilters = (
    next: FiltersState,
    scrollMode: "grid" | "top" | "none" = "none",
  ) => {
    const requestId = latestRequestIdRef.current + 1;
    latestRequestIdRef.current = requestId;
    latestLoadMoreIdRef.current += 1;
    setIsLoadingMore(false);
    const input: SearchFilterInput = {
      q: next.q || undefined,
      brand: next.brand || undefined,
      category: next.category || undefined,
      models: next.models,
      year: next.year,
      page: next.page,
      categories: next.categories,
      partsBrands: next.partsBrands,
      carBrands: next.carBrands,
      yearMin: next.yearMin,
      yearMax: next.yearMax,
      priceMin: next.priceMin,
      priceMax: next.priceMax,
    };

    // Sync Next.js router so nav links (e.g. "สินค้า" → /products) work on first click.
    // router.replace triggers a background server re-render; isAjaxUpdateRef prevents
    // the resulting renderNonce change from resetting our AJAX-driven state.
    const url = buildSearchUrl(next, basePath);
    const currentUrl =
      typeof window === "undefined"
        ? ""
        : `${window.location.pathname}${window.location.search}`;
    const shouldSyncRoute = url !== currentUrl;

    if (shouldSyncRoute) {
      setIsRouteSyncPending(true);
      isAjaxUpdateRef.current = true;
      router.replace(url, { scroll: false });
    } else {
      isAjaxUpdateRef.current = false;
      setIsRouteSyncPending(false);
    }

    // Broadcast the new filter count to the shared navbar trigger (badge).
    if (typeof window !== "undefined") {
      const search = url.includes("?") ? url.slice(url.indexOf("?")) : "";
      window.dispatchEvent(
        new CustomEvent(PRODUCT_FILTER_COUNT_EVENT, { detail: { search } }),
      );
    }

    startTransition(async () => {
      try {
        const result = await searchProductsAction(input);
        if (latestRequestIdRef.current !== requestId) return;

        // Throttled: the search never ran, so the empty payload means "we did
        // not look", not "we have nothing". Keep the current grid and say so —
        // overwriting it would read as ไม่พบสินค้า and send the customer away.
        if (result.rateLimited) {
          setIsRateLimited(true);
          return;
        }
        setIsRateLimited(false);

        setProducts(result.products);
        setTotal(result.total);
        setDidYouMean(result.didYouMean);
        setMeta({
          pageStart: result.pageStart,
          pageEnd: result.pageEnd,
          totalPages: result.totalPages,
        });
        setRequiredTokenFallback(result.requiredTokenFallback);
        setFilters(next);
        setAnimKey((k) => k + 1);

        // Defer scroll one frame after React commits the new product grid —
        // otherwise the layout shift from new content cancels a smooth scroll.
        if (scrollMode === "top") {
          requestAnimationFrame(() => {
            window.scrollTo({ top: 0, behavior: "smooth" });
          });
        } else if (scrollMode === "grid" && gridSectionRef.current) {
          const target = gridSectionRef.current;
          requestAnimationFrame(() => {
            target.scrollIntoView({ behavior: "smooth", block: "start" });
          });
        }
      } finally {
        // Clear route-sync pending state once the Server Action result is applied —
        // do not wait for the parallel router.replace() server re-render to complete.
        // If the page is cached (revalidate=300), renderNonce may not change → useEffect
        // never fires → spinner would otherwise stay stuck.
        // Keep isAjaxUpdateRef.current = true so any late-arriving renderNonce change
        // still skips the external-nav state reset; useEffect will clear that flag.
        if (latestRequestIdRef.current === requestId) {
          setIsRouteSyncPending(false);
        }
      }
    });
  };

  const hasMore = total > products.length && filters.page < meta.totalPages;
  const canAutoLoad = hasMore && filters.page < AUTO_LOAD_PAGE_LIMIT;

  const loadMoreProducts = useCallback(async () => {
    if (isPending || isLoadingMore || !hasMore) return;

    const requestId = latestLoadMoreIdRef.current + 1;
    latestLoadMoreIdRef.current = requestId;
    const nextPage = filters.page + 1;
    setIsLoadingMore(true);

    const input: SearchFilterInput = {
      q: filters.q || undefined,
      brand: filters.brand || undefined,
      category: filters.category || undefined,
      models: filters.models,
      year: filters.year,
      page: nextPage,
      categories: filters.categories,
      partsBrands: filters.partsBrands,
      carBrands: filters.carBrands,
      yearMin: filters.yearMin,
      yearMax: filters.yearMax,
      priceMin: filters.priceMin,
      priceMax: filters.priceMax,
    };

    try {
      const result = await loadMoreSearchProductsAction(input);
      if (latestLoadMoreIdRef.current !== requestId) return;

      // Same reasoning as the filter path: append nothing rather than treat a
      // declined request as "the catalogue ends here".
      if (result.rateLimited) {
        setIsRateLimited(true);
        return;
      }
      setIsRateLimited(false);

      setProducts((current) => {
        const seen = new Set(current.map((product) => product.id));
        const appended = result.products.filter((product) => !seen.has(product.id));
        return [...current, ...appended];
      });
      setTotal(result.total);
      setMeta({
        pageStart: products.length > 0 ? 1 : result.pageStart,
        pageEnd: Math.max(meta.pageEnd, result.pageEnd),
        totalPages: result.totalPages,
      });
      setFilters((current) => ({ ...current, page: result.page }));
      setRequiredTokenFallback(result.requiredTokenFallback);
    } finally {
      if (latestLoadMoreIdRef.current === requestId) {
        setIsLoadingMore(false);
      }
    }
  }, [filters, hasMore, isLoadingMore, isPending, meta.pageEnd, products.length]);

  useEffect(() => {
    if (!canAutoLoad || isLoadingMore) return;

    const target = loadMoreRef.current;
    if (!target) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMoreProducts();
        }
      },
      { rootMargin: "900px 0px" },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [canAutoLoad, isLoadingMore, loadMoreProducts]);

  // Apply-on-submit: FilterBar maintains its own draft state and submits the
  // complete next FiltersState shape at once when user clicks "ตกลง".
  const handleApplyFilters = (draft: {
    categories: string[];
    partsBrands: string[];
    carBrands: string[];
    models: string[];
    yearMin: number | null;
    yearMax: number | null;
    priceMin: number | null;
    priceMax: number | null;
  }) => {
    const next: FiltersState = {
      ...filters,
      page: 1,
      // ยึดข้อความล่าสุดในช่องค้นหาบน header — ลบคำค้นทิ้งแล้วกดตกลง q ต้องหายด้วย
      q: resolveStorefrontSearchQuery(filters.q),
      categories: draft.categories,
      partsBrands: draft.partsBrands,
      carBrands: draft.carBrands,
      models: draft.models,
      yearMin: draft.yearMin,
      yearMax: draft.yearMax,
      priceMin: draft.priceMin,
      priceMax: draft.priceMax,
    };
    applyFilters(next, "top");
  };

  const handleClearAll = () => {
    applyFilters(
      {
        q: resolveStorefrontSearchQuery(filters.q),
        brand: "",
        models: [],
        category: "",
        year: null,
        page: 1,
        categories: [],
        partsBrands: [],
        carBrands: [],
        yearMin: null,
        yearMax: null,
        priceMin: null,
        priceMax: null,
      },
      "top",
    );
  };

  const handleDidYouMeanClick = (suggestion: string) => {
    applyFilters({ ...filters, q: suggestion, page: 1 }, "none");
  };

  const hasFilter =
    Boolean(filters.q) ||
    Boolean(filters.category) ||
    Boolean(filters.brand) ||
    filters.models.length > 0 ||
    filters.categories.length > 0 ||
    filters.partsBrands.length > 0 ||
    filters.carBrands.length > 0 ||
    filters.yearMin !== null ||
    filters.yearMax !== null ||
    filters.priceMin !== null ||
    filters.priceMax !== null;

  return (
    <div className="flex flex-col lg:flex-row lg:gap-6">
      <aside className="shrink-0 lg:w-72">
        <ProductFilterBar
          carBrands={filterData.carBrands}
          categories={filterData.categories}
          partsBrands={filterData.partsBrands}
          appliedFilters={{
            categories: filters.categories,
            partsBrands: filters.partsBrands,
            carBrands: filters.carBrands,
            models: filters.models,
            yearMin: filters.yearMin,
            yearMax: filters.yearMax,
            priceMin: filters.priceMin,
            priceMax: filters.priceMax,
          }}
          onApply={handleApplyFilters}
          onClearAll={handleClearAll}
          isPending={isPending}
        />
      </aside>

      <div
        ref={gridSectionRef}
        className="min-w-0 flex-1 scroll-mt-20"
      >
        <div className="mb-2 flex flex-col gap-1 sm:mb-4 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
          <p className="text-sm text-gray-500 transition-opacity duration-200">
            {hasFilter ? (
              <>
                {filters.q && <>ค้นหา &ldquo;{filters.q}&rdquo; </>}
                {filters.categories.length > 0 && (
                  <>หมวด: {filters.categories.join(", ")} · </>
                )}
                {/* แบรนด์อะไหล่ active-filter summary hidden per request 2026-07-20 (UI only). */}
                {filters.carBrands.length > 0 && (
                  <>ยี่ห้อรถ: {filters.carBrands.join(", ")} · </>
                )}
                {filters.models.length > 0 && (
                  <>รุ่น: {filters.models.join(", ")} · </>
                )}
                {(filters.yearMin !== null || filters.yearMax !== null) && (
                  <>
                    ปี: {filters.yearMin !== null ? filters.yearMin : "ก่อนหน้า"}
                    {" – "}
                    {filters.yearMax !== null ? filters.yearMax : "ล่าสุด"}
                    {" · "}
                  </>
                )}
                {!HIDE_STOREFRONT_PRICE &&
                  (filters.priceMin !== null || filters.priceMax !== null) && (
                  <>
                    ราคา:{" "}
                    {filters.priceMin !== null ? filters.priceMin.toLocaleString() : "0"}
                    {" – "}
                    {filters.priceMax !== null
                      ? filters.priceMax.toLocaleString()
                      : "∞"}
                    {" บาท · "}
                  </>
                )}
                พบ{" "}
                <span className="font-semibold text-gray-800">{total}</span>{" "}
                รายการ
              </>
            ) : (
              <>
                แสดงสินค้า{" "}
                <span className="font-semibold text-gray-800">{total}</span>{" "}
                รายการ
              </>
            )}
          </p>

          {total > 0 && (
            <p className="text-xs text-gray-400 sm:text-sm">
              แสดง {meta.pageStart}-{meta.pageEnd} จาก {total} รายการ
            </p>
          )}
        </div>

        {/* Only ever appears after the visitor trips the per-minute search
            ceiling, never on load — so it costs no layout shift on first paint.
            Deliberately worded as "our side is busy", not "nothing found": the
            search did not run, and implying we have no such part would send a
            real customer away. */}
        {isRateLimited && (
          <div
            role="status"
            className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
          >
            ค้นหาถี่เกินไป ระบบขอพักสักครู่ — กรุณารอสักครู่แล้วลองอีกครั้ง
            (รายการที่แสดงอยู่ยังเป็นผลค้นหาก่อนหน้า)
          </div>
        )}

        <div className="relative min-h-[400px]">
          {/* Loading pill — absolute so it doesn't reserve vertical space when hidden.
              Pinned near top of the grid section; visible only while data is loading. */}
          <div
            className={`pointer-events-none absolute inset-x-0 top-2 z-20 flex justify-center transition-all duration-200 ${
              isPending
                ? "translate-y-0 opacity-100"
                : "-translate-y-2 opacity-0"
            }`}
            aria-hidden={!isPending}
          >
            <div className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-lg ring-1 ring-slate-200">
              <Loader2 className="h-4 w-4 animate-spin text-[#f97316]" />
              <span>กำลังโหลด...</span>
            </div>
          </div>

          <div
            className={`transition-all duration-300 ease-out ${
              isPending
                ? "scale-[0.99] opacity-50 blur-[1px]"
                : "scale-100 opacity-100 blur-0"
            }`}
            aria-busy={isPending}
          >
            {products.length === 0 ? (
              <div className="py-16 text-center text-gray-400 animate-in fade-in-0 duration-300">
                <p className="mb-2 text-lg">ไม่พบสินค้าที่ค้นหา</p>
                {didYouMean.length > 0 && (
                  <div className="mb-4">
                    <p className="mb-2 text-sm text-gray-600">คุณหมายถึง:</p>
                    <div className="flex flex-wrap justify-center gap-2">
                      {didYouMean.map((suggestion) => (
                        <button
                          key={suggestion}
                          type="button"
                          onClick={() => handleDidYouMeanClick(suggestion)}
                          className="inline-flex items-center rounded-full border border-[#1e3a5f]/20 bg-[#1e3a5f]/5 px-3 py-1 text-sm font-medium text-[#1e3a5f] transition hover:border-[#1e3a5f] hover:bg-[#1e3a5f]/10"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <Link
                  href="/products"
                  className="text-sm text-[#1e3a5f] underline"
                >
                  ดูสินค้าทั้งหมด
                </Link>
              </div>
            ) : (
              <>
                <div
                  key={animKey}
                  className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3"
                >
                  {products.map((product, index) => (
                    <div
                      key={product.id}
                      className="h-full animate-in fade-in-0 slide-in-from-bottom-3 fill-mode-both"
                      style={{
                        animationDuration: "350ms",
                        animationDelay: `${Math.min(index, 8) * 30}ms`,
                        animationTimingFunction: "ease-out",
                      }}
                    >
                      <ProductCard
                        product={product}
                        lineUrl={lineUrl}
                        prefetchDetail={false}
                      />
                    </div>
                  ))}
                  {isLoadingMore &&
                    Array.from({ length: 6 }).map((_, index) => (
                      <ProductCardSkeleton key={`loading-more-${index}`} />
                    ))}
                </div>

                {hasMore && (
                  <div ref={loadMoreRef} className="mt-8 flex justify-center">
                    {canAutoLoad ? (
                      <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-500 shadow-sm">
                        <Loader2 className="h-4 w-4 animate-spin text-[#f97316]" />
                        <span>กำลังโหลดสินค้าเพิ่มเติม...</span>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void loadMoreProducts()}
                        disabled={isLoadingMore}
                        className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-6 py-2.5 text-sm font-semibold text-[#10213d] shadow-sm transition hover:border-[#f97316]/40 hover:bg-orange-50 hover:text-[#f97316] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isLoadingMore ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span>กำลังโหลด...</span>
                          </>
                        ) : (
                          <span>ดูเพิ่มเติม</span>
                        )}
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SearchResults;
