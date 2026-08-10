"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import Home2ProductCard from "./Home2ProductCard";
// Type-only: home2-data pulls in the Prisma client, which must never reach the
// browser bundle. Any value needed here is declared locally instead.
import type { Home2ProductCardData, Home2ProductPage } from "./home2-data";
import { loadMoreHome2NewArrivalsAction } from "./home2-new-arrivals-actions";
import { HOME2_SECTION_CARD_CLASS } from "./home2-theme";

/**
 * Pages fetched automatically on scroll before the manual button appears.
 * 2 → 24 render, 24 more auto-load, then "โหลดเพิ่มเติม" from 48 on.
 */
const AUTO_LOAD_PAGE_LIMIT = 2;
/** Placeholder cards rendered while the next page is in flight. */
const SKELETON_COUNT = 6;
/**
 * How far before the sentinel the next page starts loading. Kept short so the
 * list genuinely rests at its initial 24 until the reader reaches the end —
 * a large margin fired almost immediately and the count jumped to 48 on load.
 */
const PREFETCH_ROOT_MARGIN = "150px 0px";

const CardSkeleton = () => (
  <div className="overflow-hidden rounded-xl border border-[#e3ecf8] bg-white">
    <div className="aspect-square w-full animate-pulse bg-[#f4f7fc]" />
    <div className="space-y-2 p-2.5">
      <div className="h-3 w-full animate-pulse rounded bg-[#eff5fc]" />
      <div className="h-3 w-2/3 animate-pulse rounded bg-[#eff5fc]" />
      <div className="h-6 w-full animate-pulse rounded-lg bg-[#eff5fc]" />
    </div>
  </div>
);

interface Props {
  initialPage: Home2ProductPage;
  lineUrl: string;
}

/**
 * "สินค้ามาใหม่" as a paginated vertical list, matching /products' behaviour:
 * the first extra page auto-loads on scroll, then a manual "โหลดเพิ่มเติม"
 * button takes over so we never fetch the whole catalogue unattended.
 */
const Home2NewArrivals = ({ initialPage, lineUrl }: Props) => {
  const [products, setProducts] = useState<Home2ProductCardData[]>(initialPage.products);
  const [total, setTotal] = useState(initialPage.total);
  const [loadedPage, setLoadedPage] = useState(initialPage.page);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const latestRequestIdRef = useRef(0);

  const totalPages = Math.max(1, Math.ceil(total / initialPage.pageSize));
  const hasMore = products.length < total && loadedPage < totalPages;
  const canAutoLoad = hasMore && loadedPage < AUTO_LOAD_PAGE_LIMIT;

  // Restoring from bfcache would otherwise show a long, stale list.
  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      setProducts(initialPage.products);
      setTotal(initialPage.total);
      setLoadedPage(initialPage.page);
      setIsLoadingMore(false);
    };

    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, [initialPage]);

  const loadMoreProducts = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;

    const requestId = latestRequestIdRef.current + 1;
    latestRequestIdRef.current = requestId;
    setIsLoadingMore(true);

    try {
      const result = await loadMoreHome2NewArrivalsAction({ page: loadedPage + 1 });
      if (latestRequestIdRef.current !== requestId) return;

      setProducts((current) => {
        const seen = new Set(current.map((product) => product.id));
        return [...current, ...result.products.filter((product) => !seen.has(product.id))];
      });
      setTotal(result.total);
      setLoadedPage(result.page);
    } finally {
      if (latestRequestIdRef.current === requestId) setIsLoadingMore(false);
    }
  }, [hasMore, isLoadingMore, loadedPage]);

  useEffect(() => {
    if (!canAutoLoad || isLoadingMore) return;

    const target = loadMoreRef.current;
    if (!target) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMoreProducts();
      },
      { rootMargin: PREFETCH_ROOT_MARGIN },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [canAutoLoad, isLoadingMore, loadMoreProducts]);

  if (products.length === 0) return null;

  return (
    <section className="mx-auto max-w-7xl px-4 pt-3 sm:px-6 lg:px-8">
      <div className={HOME2_SECTION_CARD_CLASS}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eef3fa] px-4 py-3 sm:px-5">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 className="font-kanit text-base font-bold text-[#1e3a5f] sm:text-lg">สินค้ามาใหม่</h2>
          </div>
          <p className="text-xs text-slate-400 sm:text-sm">
            แสดง {products.length.toLocaleString("th-TH")} จาก {total.toLocaleString("th-TH")} รายการ
          </p>
        </div>

        <div className="p-3 sm:p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {products.map((product) => (
              <Home2ProductCard key={product.id} product={product} lineUrl={lineUrl} />
            ))}
            {isLoadingMore &&
              Array.from({ length: SKELETON_COUNT }).map((_, index) => (
                <CardSkeleton key={`home2-new-arrivals-skeleton-${index}`} />
              ))}
          </div>

          {hasMore && (
            <div ref={loadMoreRef} className="mt-6 flex justify-center">
              {canAutoLoad ? (
                <div className="inline-flex items-center gap-2 rounded-full border border-[#dbe6f5] bg-white px-5 py-2.5 text-sm font-semibold text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin text-[#2563eb]" />
                  <span>กำลังโหลดสินค้าเพิ่มเติม...</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void loadMoreProducts()}
                  disabled={isLoadingMore}
                  className="inline-flex items-center gap-2 rounded-full bg-[#1e3a5f] px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#163055] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isLoadingMore ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>กำลังโหลด...</span>
                    </>
                  ) : (
                    <span>โหลดเพิ่มเติม</span>
                  )}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default Home2NewArrivals;
