"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import ProductCard from "@/components/shared/ProductCard";
import Pagination from "@/components/shared/Pagination";
import type { SearchProductItem } from "@/lib/storefront-product-search";
import ProductFilterBar from "../ProductFilterBar";
import {
  searchProductsAction,
  type SearchFilterInput,
} from "./search-products-actions";

type CarBrand = {
  id: string;
  name: string;
  carModels: Array<{ id: string; name: string }>;
};
type Category = { id: string; name: string };

type FilterData = {
  carBrands: CarBrand[];
  categories: Category[];
};

type FiltersState = {
  q: string;
  brand: string;
  models: string[];
  category: string;
  year: number | null;
  page: number;
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
  renderNonce: number;
}

const buildSearchUrl = (f: FiltersState, basePath: string): string => {
  const params = new URLSearchParams();
  if (f.q) params.set("q", f.q);
  if (f.category) params.set("category", f.category);
  if (f.brand) params.set("brand", f.brand);
  f.models.forEach((m) => params.append("model", m));
  if (f.year) params.set("year", String(f.year));
  if (f.page > 1) params.set("page", String(f.page));
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
};

const SearchResults = ({
  initialProducts,
  initialTotal,
  initialDidYouMean,
  initialFilters,
  initialMeta,
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
  const [isPending, startTransition] = useTransition();
  const [animKey, setAnimKey] = useState(0);
  const gridSectionRef = useRef<HTMLDivElement>(null);
  const skipNextScrollRef = useRef(true);
  const prevNonceRef = useRef(renderNonce);
  // true while a server re-render is triggered by our own AJAX filter (not user nav)
  const isAjaxUpdateRef = useRef(false);
  const router = useRouter();

  useEffect(() => {
    if (prevNonceRef.current === renderNonce) return;
    prevNonceRef.current = renderNonce;

    if (isAjaxUpdateRef.current) {
      // Background server re-render from our own router.replace — skip state reset
      isAjaxUpdateRef.current = false;
      return;
    }

    // External navigation (nav link, browser back/forward) — reset to server state
    setProducts(initialProducts);
    setTotal(initialTotal);
    setDidYouMean(initialDidYouMean);
    setFilters(initialFilters);
    setMeta(initialMeta);
    setAnimKey((k) => k + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderNonce]);

  const applyFilters = (next: FiltersState, scrollIntoView: boolean) => {
    const input: SearchFilterInput = {
      q: next.q || undefined,
      brand: next.brand || undefined,
      category: next.category || undefined,
      models: next.models,
      year: next.year,
      page: next.page,
    };

    // Sync Next.js router so nav links (e.g. "สินค้า" → /products) work on first click.
    // router.replace triggers a background server re-render; isAjaxUpdateRef prevents
    // the resulting renderNonce change from resetting our AJAX-driven state.
    const url = buildSearchUrl(next, basePath);
    isAjaxUpdateRef.current = true;
    router.replace(url, { scroll: false });

    startTransition(async () => {
      const result = await searchProductsAction(input);

      setProducts(result.products);
      setTotal(result.total);
      setDidYouMean(result.didYouMean);
      setMeta({
        pageStart: result.pageStart,
        pageEnd: result.pageEnd,
        totalPages: result.totalPages,
      });
      setFilters(next);
      setAnimKey((k) => k + 1);

      if (scrollIntoView && gridSectionRef.current) {
        gridSectionRef.current.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }
    });
  };

  const handleFilterChange = (updates: Record<string, string | string[]>) => {
    const next: FiltersState = { ...filters, page: 1 };

    for (const [key, value] of Object.entries(updates)) {
      if (key === "brand" && typeof value === "string") {
        next.brand = value;
        // Clear models when switching brand
        if (value !== filters.brand) next.models = [];
      } else if (key === "category" && typeof value === "string") {
        next.category = value;
      } else if (key === "model" && Array.isArray(value)) {
        next.models = value.filter(Boolean);
      }
    }

    applyFilters(next, false);
  };

  const handleClearAll = () => {
    applyFilters(
      {
        q: filters.q,
        brand: "",
        models: [],
        category: "",
        year: null,
        page: 1,
      },
      false,
    );
  };

  const handlePageChange = (page: number) => {
    applyFilters({ ...filters, page }, true);
  };

  const handleDidYouMeanClick = (suggestion: string) => {
    applyFilters({ ...filters, q: suggestion, page: 1 }, false);
  };

  // Sync state back if browser back/forward changes URL (e.g. external)
  useEffect(() => {
    skipNextScrollRef.current = false;
  }, []);

  const hasFilter =
    Boolean(filters.q) ||
    Boolean(filters.category) ||
    Boolean(filters.brand) ||
    filters.models.length > 0;

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <aside className="w-full shrink-0 lg:w-72">
        <ProductFilterBar
          brands={filterData.carBrands}
          categories={filterData.categories}
          controlledFilters={{
            q: filters.q,
            brand: filters.brand,
            models: filters.models,
            category: filters.category,
            page: filters.page > 1 ? String(filters.page) : "",
          }}
          onNavigate={handleFilterChange}
          onClearAll={handleClearAll}
          isPending={isPending}
        />
      </aside>

      <div
        ref={gridSectionRef}
        className="min-w-0 flex-1 scroll-mt-20"
      >
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-gray-500 transition-opacity duration-200">
            {hasFilter ? (
              <>
                {filters.q && <>ค้นหา &ldquo;{filters.q}&rdquo; </>}
                {filters.brand && (
                  <>
                    {filters.brand}
                    {filters.models.length > 0
                      ? ` › ${filters.models.join(", ")}`
                      : ""}{" "}
                  </>
                )}
                {filters.category && <>{filters.category} </>}
                — พบ{" "}
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

        <div className="relative min-h-[400px]">
          {/* Loading pill — sticky at top so it remains visible while scrolling */}
          <div
            className={`pointer-events-none sticky top-20 z-20 mb-3 flex justify-center transition-all duration-200 ${
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
                  className="grid grid-cols-2 gap-3 xl:grid-cols-3"
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
                </div>

                {meta.totalPages > 1 && (
                  <div className="mt-8 rounded-3xl border border-gray-200 bg-white px-4 py-4 shadow-sm sm:px-6">
                    <Pagination
                      currentPage={filters.page}
                      totalPages={meta.totalPages}
                      buildHref={(page) =>
                        buildSearchUrl({ ...filters, page }, basePath)
                      }
                      onNavigate={handlePageChange}
                      isPending={isPending}
                    />
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
