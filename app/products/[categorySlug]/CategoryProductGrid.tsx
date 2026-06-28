"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import ProductCard from "@/components/shared/ProductCard";
import ScrollReveal from "@/components/shared/ScrollReveal";
import type { StorefrontCategoryProductItem } from "@/lib/storefront-category";
import { loadMoreCategoryProductsAction } from "./category-products-actions";

const AUTO_LOAD_PAGE_LIMIT = 5;

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

type Props = {
  categoryId: string;
  initialProducts: StorefrontCategoryProductItem[];
  initialTotal: number;
  initialPage: number;
  pageSize: number;
  lineUrl: string;
};

const CategoryProductGrid = ({
  categoryId,
  initialProducts,
  initialTotal,
  initialPage,
  pageSize,
  lineUrl,
}: Props) => {
  const [products, setProducts] =
    useState<StorefrontCategoryProductItem[]>(initialProducts);
  const [total, setTotal] = useState(initialTotal);
  const [loadedPage, setLoadedPage] = useState(initialPage);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const latestRequestIdRef = useRef(0);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasMore = products.length < total && loadedPage < totalPages;
  const canAutoLoad = hasMore && loadedPage < AUTO_LOAD_PAGE_LIMIT;

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  useEffect(() => {
    const resetToInitial = (scrollToTop: boolean) => {
      setProducts(initialProducts);
      setTotal(initialTotal);
      setLoadedPage(initialPage);
      setIsLoadingMore(false);
      if (scrollToTop) window.scrollTo({ top: 0, behavior: "auto" });
    };

    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) resetToInitial(true);
    };

    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, [initialPage, initialProducts, initialTotal]);

  const loadMoreProducts = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;

    const requestId = latestRequestIdRef.current + 1;
    latestRequestIdRef.current = requestId;
    const nextPage = loadedPage + 1;
    setIsLoadingMore(true);

    try {
      const result = await loadMoreCategoryProductsAction({
        categoryId,
        page: nextPage,
      });
      if (latestRequestIdRef.current !== requestId) return;

      setProducts((current) => {
        const seen = new Set(current.map((product) => product.id));
        const appended = result.products.filter((product) => !seen.has(product.id));
        return [...current, ...appended];
      });
      setTotal(result.total);
      setLoadedPage(result.page);
    } finally {
      if (latestRequestIdRef.current === requestId) {
        setIsLoadingMore(false);
      }
    }
  }, [categoryId, hasMore, isLoadingMore, loadedPage]);

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

  if (products.length === 0) {
    return (
      <div className="rounded-[28px] border border-slate-200 bg-white px-6 py-16 text-center text-slate-500 shadow-sm">
        ยังไม่มีสินค้าที่เปิดใช้งานในหมวดนี้ตอนนี้
      </div>
    );
  }

  return (
    <>
      <p className="mb-4 text-sm text-slate-500">
        แสดง 1-{products.length.toLocaleString("th-TH")} จาก{" "}
        {total.toLocaleString("th-TH")} รายการ
      </p>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {products.map((product, index) => (
          <ScrollReveal key={product.id} delay={index < 8 ? index * 50 : 0} className="h-full">
            <ProductCard
              product={product}
              lineUrl={lineUrl}
              prefetchDetail={false}
            />
          </ScrollReveal>
        ))}
        {isLoadingMore &&
          Array.from({ length: 4 }).map((_, index) => (
            <ProductCardSkeleton key={`category-loading-more-${index}`} />
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
  );
};

export default CategoryProductGrid;
